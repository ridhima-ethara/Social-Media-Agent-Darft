/**
 * GOOGLE CLOUD AUTHENTICATION
 *
 * Two credentials, one accessor. Every Google call in the product goes through
 * `gcpAuthHeader()` so that "which credential authenticated this" is answered in
 * one place rather than at each call site.
 *
 *   · GCP_API_KEY               the AI Studio key. Sent as `x-goog-api-key` to
 *                               the public Generative Language API. Nothing to
 *                               exchange, nothing to cache.
 *
 *   · GCP_SERVICE_ACCOUNT_JSON  a service account, for Vertex. Google does not
 *                               accept the key itself as a bearer token: the
 *                               private key signs a JWT, the JWT is exchanged
 *                               for a short-lived OAuth access token, and that
 *                               token is the bearer. Implemented here because
 *                               without it a service account was accepted by
 *                               configuration, reported as configured, and then
 *                               sent as `Bearer <empty>` — a 401 at call time
 *                               dressed up as a working setup.
 *
 * WHY NOT google-auth-library. The exchange is one signed JWT and one form POST,
 * and `node:crypto` signs RS256 out of the box. Pulling a dependency tree in for
 * sixty lines would be the larger cost, and this file is the whole surface.
 *
 * THE PRIVATE KEY NEVER LEAVES THIS MODULE. It is read from disk, used to sign,
 * and never logged, returned or attached to an error message.
 */

import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { config } from '../config'
import { AdapterError } from './adapter'

/** The scope Vertex AI requires. Nothing broader is requested. */
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

/** Refresh this many seconds before expiry, so a call never races the boundary. */
const EXPIRY_MARGIN_SECONDS = 60

interface ServiceAccount {
  type?: string
  project_id?: string
  client_email?: string
  private_key?: string
  token_uri?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   READING THE CREDENTIAL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `GCP_SERVICE_ACCOUNT_JSON` may hold the JSON itself or a path to it.
 *
 * Both spellings exist in the wild — a container injects the body, a developer
 * points at a file — so both are accepted rather than making the operator
 * discover which one this build wanted. A relative path resolves from the server
 * directory, which is where `.env` and `secrets.env` also live.
 */
function readServiceAccount(): ServiceAccount | null {
  const raw = config.gcp.serviceAccountJson
  if (raw === '') return null

  let body = raw
  if (!raw.trimStart().startsWith('{')) {
    const path = isAbsolute(raw) ? raw : join(process.cwd(), raw)
    const fallback = isAbsolute(raw) ? raw : join(process.cwd(), '..', raw)
    const found = existsSync(path) ? path : existsSync(fallback) ? fallback : ''
    if (found === '') return null
    try {
      body = readFileSync(found, 'utf8')
    } catch {
      return null
    }
  }

  try {
    const parsed = JSON.parse(body) as ServiceAccount
    // A JSON file that is not a service account is not a credential. Saying so
    // beats presenting an empty bearer token and reading the 401 later.
    if (!parsed.client_email || !parsed.private_key) return null
    return parsed
  } catch {
    return null
  }
}

/** Whether a usable service account is present. Cheap enough to call per request. */
export function hasServiceAccount(): boolean {
  return readServiceAccount() !== null
}

/** What is wrong with the service account, for an operator-facing reason. */
export function serviceAccountProblem(): string {
  const raw = config.gcp.serviceAccountJson
  if (raw === '') return 'GCP_SERVICE_ACCOUNT_JSON is not set'
  if (raw.trimStart().startsWith('{')) {
    return 'GCP_SERVICE_ACCOUNT_JSON holds JSON that is not a service account (no client_email/private_key)'
  }
  const path = isAbsolute(raw) ? raw : join(process.cwd(), raw)
  const fallback = isAbsolute(raw) ? raw : join(process.cwd(), '..', raw)
  if (!existsSync(path) && !existsSync(fallback)) {
    return `GCP_SERVICE_ACCOUNT_JSON points at ${raw}, which does not exist`
  }
  return `${raw} is not a readable service-account JSON (needs client_email and private_key)`
}

/** The service account's own project, used when GCP_PROJECT_ID is not set. */
export function serviceAccountProjectId(): string {
  return readServiceAccount()?.project_id ?? ''
}

/** The identity that will be presented, for the health report. Never the key. */
export function serviceAccountEmail(): string {
  return readServiceAccount()?.client_email ?? ''
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE EXCHANGE
   ═══════════════════════════════════════════════════════════════════════════ */

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/**
 * One cached token per process.
 *
 * Tokens last an hour and every agent in a run needs one, so minting per call
 * would add a round trip to every caption and every rewrite. Keyed on the client
 * email so rotating the credential without a restart cannot serve a token minted
 * for the previous identity.
 */
let cached: { identity: string; token: string; expiresAt: number } | null = null

async function mintAccessToken(account: ServiceAccount): Promise<string> {
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)

  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }

  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify(claims),
  )}`

  let signature: string
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(unsigned)
    signer.end()
    // The `\n` escapes survive a round trip through dotenv and JSON; the PEM
    // parser needs real newlines.
    const pem = (account.private_key as string).replace(/\\n/g, '\n')
    signature = base64url(signer.sign(pem))
  } catch (error) {
    // Deliberately does not echo the key or the OpenSSL detail, which can
    // include key material.
    throw new AdapterError(
      'gcp.auth',
      `the service-account private key could not sign a token — check that ${
        config.gcp.serviceAccountJson
      } is the complete, unmodified JSON Google issued (${
        error instanceof Error ? error.name : 'unknown error'
      })`,
    )
  }

  let response: Response
  try {
    response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new AdapterError(
      'gcp.auth',
      `could not reach Google's token endpoint — ${error instanceof Error ? error.message : 'network error'}`,
    )
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok || !payload.access_token) {
    // Google's own words. `invalid_grant` here almost always means the system
    // clock is skewed or the key has been revoked, and saying which is more
    // useful than a generic failure.
    const detail =
      payload.error_description ?? payload.error ?? `HTTP ${response.status} ${response.statusText}`
    throw new AdapterError(
      'gcp.auth',
      `the service account was rejected — ${detail}. Identity: ${account.client_email ?? 'unknown'}`,
    )
  }

  const lifetime = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  cached = {
    identity: account.client_email ?? '',
    token: payload.access_token,
    expiresAt: Date.now() + (lifetime - EXPIRY_MARGIN_SECONDS) * 1000,
  }
  return payload.access_token
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT CALLERS USE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The header that authenticates a Google call, chosen by which credential
 * exists. An API key wins when both are present: it needs no round trip, and an
 * operator who set one is naming the public endpoint.
 */
export async function gcpAuthHeader(): Promise<Record<string, string>> {
  if (config.gcp.apiKey !== '') {
    return config.gcp.useVertex
      ? { authorization: `Bearer ${config.gcp.apiKey}` }
      : { 'x-goog-api-key': config.gcp.apiKey }
  }

  const account = readServiceAccount()
  if (account === null) throw new AdapterError('gcp.auth', serviceAccountProblem())

  if (cached !== null && cached.identity === account.client_email && Date.now() < cached.expiresAt) {
    return { authorization: `Bearer ${cached.token}` }
  }

  return { authorization: `Bearer ${await mintAccessToken(account)}` }
}

/** True when SOME usable Google credential exists. */
export function gcpAuthAvailable(): boolean {
  return config.gcp.apiKey !== '' || hasServiceAccount()
}

/**
 * Which credential will be presented, and over which endpoint. Reported at boot
 * and by `/health`, because "which identity wrote this" is a question an
 * operator asks of every generated artefact.
 */
export function describeGcpAuth(): string {
  if (config.gcp.apiKey !== '') {
    return config.gcp.useVertex
      ? 'GCP_API_KEY as a bearer token against Vertex'
      : 'GCP_API_KEY against the public Generative Language API'
  }
  if (hasServiceAccount()) {
    return `service account ${serviceAccountEmail()} exchanged for an access token, against Vertex`
  }
  return serviceAccountProblem()
}

/** Clears the cached token. Used when a credential changes underneath us. */
export function resetGcpAuthCache(): void {
  cached = null
}
