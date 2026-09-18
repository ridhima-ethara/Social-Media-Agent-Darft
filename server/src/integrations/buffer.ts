/**
 * BUFFER — the publishing lane, via a broker that already holds the platform grants.
 *
 * WHY THIS REPLACED THE DIRECT LINKEDIN CONNECTOR. Posting to a LinkedIn Company
 * Page needs the `w_organization_social` scope, which is issued only through
 * LinkedIn's Community Management API — a reviewed programme restricted to
 * registered legal organisations. This app was refused it at the authorisation
 * step (`unauthorized_scope_error`), so the direct connector could reach a
 * personal profile and never a Page.
 *
 * Buffer already holds those grants. The operator connects the Page inside
 * Buffer once, and this posts through Buffer's API — so the capability we could
 * not obtain is borrowed rather than reimplemented. It also generalises: the same
 * token reaches Instagram, X and Facebook channels, which had no live path at all.
 *
 * WHAT THIS COSTS. The post is no longer dispatched by us, so the receipt is
 * Buffer's update id, not the platform's post id. That is recorded honestly —
 * a Buffer id is not a LinkedIn permalink and is not presented as one.
 *
 * THE API IS GRAPHQL, NOT REST. `api.bufferapp.com/1` still answers, and a key
 * created today is rejected by it with "Public API tokens are not accepted for
 * REST API access" — verified against this account. Current keys work only against
 * the GraphQL endpoint at `api.buffer.com`, so that is what this uses.
 *
 * `mode: shareNow` is not optional. Buffer's default is `addToQueue`, which files
 * the post in a schedule; a Leadership approval means "this goes out now", and
 * queueing it would report success while nothing published.
 */

import type { Platform } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError } from './adapter'

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */

/** True only when a post could actually be sent. */
export function isConfigured(): boolean {
  return config.buffer.accessToken !== ''
}

/**
 * Why Buffer cannot publish, naming the specific missing piece.
 *
 * A channel id is optional — it is discovered from the token when absent — so a
 * missing one is not reported as a failure here.
 */
export function unavailableReason(): string {
  if (config.buffer.accessToken === '') {
    return (
      'BUFFER_ACCESS_TOKEN is not set. Create an API key at buffer.com (profile icon → ' +
      'Settings → API), connect the channels you want to post to, then set it in ' +
      'server/secrets.env.'
    )
  }
  return ''
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSPORT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One GraphQL request.
 *
 * GraphQL answers HTTP 200 with an `errors` array, so a transport-level check is
 * not enough — a failed mutation looks like a success to `response.ok`. Both are
 * inspected here so no caller can forget to.
 */
async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(config.buffer.apiBase, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.buffer.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new AdapterError(
      'buffer',
      `Buffer could not be reached — ${error instanceof Error ? error.message : 'network error'}`,
    )
  }

  const text = await response.text()
  if (!response.ok) {
    throw new AdapterError('buffer', explainStatus(response.status, text), response.status)
  }

  let payload: { data?: T; errors?: { message?: string }[] }
  try {
    payload = JSON.parse(text) as typeof payload
  } catch {
    throw new AdapterError('buffer', `Buffer returned a non-JSON response: ${text.slice(0, 160)}`)
  }

  if (payload.errors !== undefined && payload.errors.length > 0) {
    const joined = payload.errors.map((e) => e.message ?? 'unknown').join('; ')
    throw new AdapterError('buffer', `Buffer rejected the request — ${joined}`)
  }
  if (payload.data === undefined) {
    throw new AdapterError('buffer', 'Buffer returned no data and no error, so nothing can be confirmed')
  }
  return payload.data
}

/**
 * Turns Buffer's status into an instruction.
 *
 * The body carries Buffer's own wording, which is preferred over anything invented
 * here; the status only supplies the action when the body is bare.
 */
function explainStatus(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string }
    detail = parsed.error ?? parsed.message ?? ''
  } catch {
    detail = body.slice(0, 200)
  }
  switch (status) {
    case 401:
    case 403:
      return `Buffer rejected the credential (${status}). ${detail || 'The API key is invalid or revoked.'} Create one at publish.buffer.com/settings/api and update BUFFER_ACCESS_TOKEN in server/secrets.env.`
    case 429:
      return `Buffer is rate-limiting this key (429). ${detail || 'Wait before retrying.'} Nothing was published.`
    default:
      return detail === '' ? `Buffer returned HTTP ${status}` : `Buffer: ${detail}`
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHANNELS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface BufferChannel {
  id: string
  service: string
  /** The handle or page name, for the operator to recognise. */
  name: string
  /** Buffer distinguishes a page from a personal profile here. */
  type: string
}

const ORGS_QUERY = `
  query GetOrganizations {
    account {
      organizations {
        id
      }
    }
  }
`

const CHANNELS_QUERY = `
  query GetChannels($input: ChannelsInput!) {
    channels(input: $input) {
      id
      service
      name
      type
    }
  }
`

interface OrgsData {
  account?: { organizations?: { id?: string }[] }
}

interface ChannelsData {
  channels?: { id?: string; service?: string; name?: string; type?: string }[]
}

/*
 * The organisation id, resolved once per process.
 *
 * `channels` is a ROOT query taking an organisation id — not a field on the
 * account — so the id must be fetched first. Two round trips is why both this and
 * the channel list are cached.
 */
let orgCache: string | null = null

async function organizationId(timeoutMs: number): Promise<string> {
  if (orgCache !== null) return orgCache
  const data = await graphql<OrgsData>(ORGS_QUERY, {}, timeoutMs)
  const id = data.account?.organizations?.[0]?.id
  if (id === undefined || id === '') {
    throw new AdapterError(
      'buffer',
      'This Buffer key reaches no organisation, so it has nowhere to post. Check the key at publish.buffer.com/settings/api.',
    )
  }
  orgCache = id
  return id
}

/**
 * Every channel this key can post to.
 *
 * The first organisation is used. A Buffer API key scopes to one account, and
 * multi-organisation accounts are an Agency-plan feature outside what this product
 * configures — pinning a channel id explicitly covers that case without needing to
 * model organisations here.
 */
export async function listChannels(timeoutMs?: number): Promise<BufferChannel[]> {
  const reason = unavailableReason()
  if (reason !== '') throw new AdapterError('buffer', reason)

  const ms = timeoutMs ?? config.buffer.timeoutMs
  const data = await graphql<ChannelsData>(
    CHANNELS_QUERY,
    { input: { organizationId: await organizationId(ms) } },
    ms,
  )
  return (data.channels ?? []).map((c) => ({
    id: c.id ?? '',
    service: (c.service ?? '').toLowerCase(),
    name: c.name ?? '',
    type: c.type ?? '',
  }))
}

/*
 * Discovered channel ids, cached for the process.
 *
 * Resolution costs a round trip, and the publish path is already the slowest
 * thing in the product. The cache is per-process rather than persisted, so
 * connecting a new channel in Buffer takes effect on the next API restart —
 * stale-until-restart is acceptable, silently posting to a channel the operator
 * disconnected is not, which is why a 404 clears it below.
 */
let channelCache: BufferChannel[] | null = null

/**
 * Which Buffer channel serves a platform.
 *
 * An explicit `BUFFER_PROFILE_ID_LINKEDIN` always wins, because an account with
 * two LinkedIn channels — a personal profile and a Page — would otherwise be
 * resolved by whichever Buffer happened to list first, and posting to the wrong
 * one is not recoverable.
 */
export async function channelFor(platform: Platform): Promise<string> {
  const explicit = config.buffer.profileIdFor(platform)
  if (explicit !== '') return explicit

  channelCache ??= await listChannels()
  const matches = channelCache.filter((c) => c.service === platform)

  if (matches.length === 0) {
    const available = channelCache.map((c) => c.service).join(', ') || 'none'
    throw new AdapterError(
      'buffer',
      `No ${platform} channel is connected to this Buffer account. Connected: ${available}. ` +
        `Connect it at buffer.com, or set BUFFER_PROFILE_ID_${platform.toUpperCase()} explicitly.`,
    )
  }
  if (matches.length > 1) {
    // Ambiguity is refused rather than guessed — see the note above.
    throw new AdapterError(
      'buffer',
      `This Buffer account has ${matches.length} ${platform} channels (${matches
        .map((c) => `${c.name || c.id} [${c.type}]`)
        .join(', ')}). Set BUFFER_PROFILE_ID_${platform.toUpperCase()} to the one you mean, so the ` +
        `post cannot land on the wrong feed.`,
    )
  }
  return matches[0]?.id ?? ''
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLISHING
   ═══════════════════════════════════════════════════════════════════════════ */

const CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post {
          id
          text
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`

interface CreatePostData {
  createPost?: {
    post?: { id?: string }
    message?: string
  }
}

export interface BufferDispatch {
  platform: Platform
  body: string
  altText: string
  /** A public image URL, or null for text only. */
  mediaUrl: string | null
  timeoutMs: number
}

/**
 * Publishes now. Returns the receipt the product records permanently.
 *
 * `mode: shareNow` rather than Buffer's default `addToQueue` — a Leadership
 * approval means the post goes out, and queueing it would report success while
 * nothing published.
 */
export async function dispatch(
  input: BufferDispatch,
): Promise<{ externalId: string; url: string; dispatchedAt: string }> {
  const reason = unavailableReason()
  if (reason !== '') throw new AdapterError('buffer', reason)

  const channelId = await channelFor(input.platform)

  const postInput: Record<string, unknown> = {
    text: input.body,
    channelId,
    // `automatic` posts without human action on a phone; `notification` would only
    // nudge the operator to publish by hand, which is not what approval means.
    schedulingType: 'automatic',
    mode: 'shareNow',
  }
  /*
   * THE IMAGE.
   *
   * `CreatePostInput.assets` takes an `ImageAssetInput`, whose only required field
   * is `url` — Buffer FETCHES the image, there is no upload mutation on this
   * schema (verified by introspection). So the URL has to be reachable from
   * Buffer's servers, which is why a data URI cannot be passed here and why
   * PUBLIC_BASE_URL exists.
   *
   * `thumbnailUrl` is set to the same image deliberately: Buffer uses it for its
   * own composer preview, and pointing it at a second URL that could 404
   * independently would mean the operator's preview and the published post could
   * disagree.
   */
  if (input.mediaUrl !== null) {
    postInput.assets = {
      image: {
        url: input.mediaUrl,
        thumbnailUrl: input.mediaUrl,
      },
    }
  }

  let data: CreatePostData
  try {
    data = await graphql<CreatePostData>(CREATE_POST, { input: postInput }, input.timeoutMs)
  } catch (error) {
    // A disconnected channel invalidates the cache, or every later publish in this
    // process would repeat the same stale lookup.
    channelCache = null
    throw error
  }

  const result = data.createPost
  const id = result?.post?.id
  if (id === undefined || id === '') {
    throw new AdapterError(
      'buffer',
      `Buffer did not create the post${result?.message === undefined ? '' : ` — ${result.message}`}.`,
    )
  }

  return {
    externalId: id,
    // Buffer's own record, NOT a platform permalink. The platform post id is not
    // returned here, so claiming one would be fabricating a receipt.
    url: `https://publish.buffer.com/post/${id}`,
    dispatchedAt: new Date().toISOString(),
  }
}
/** For `/api/health`, so the mode is visible before anyone presses publish. */
export function describeBuffer(): string {
  const reason = unavailableReason()
  if (reason !== '') return reason
  const pinned = (['linkedin', 'instagram', 'x', 'facebook'] as Platform[])
    .filter((p) => config.buffer.profileIdFor(p) !== '')
    .join(', ')
  return pinned === ''
    ? 'Ready — channels resolved from the token at publish time'
    : `Ready — pinned channels: ${pinned}; others resolved from the token`
}
