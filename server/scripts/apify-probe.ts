/**
 * APIFY PROBE
 *
 * Proves the Apify setup rather than asserting it: token validity, that each
 * configured actor exists, and — with `--live` — a three-post real search so
 * the normaliser is checked against the actor's actual output.
 *
 *   npm run apify:probe            # token + actors, no paid run
 *   npm run apify:probe -- --live  # plus one capped live search (pay-per-result)
 */

import { config as loadEnv } from 'dotenv'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: join(ROOT, '.env') })

const { config } = await import('../src/config')
const { apifyPostSearch } = await import('../src/integrations/apify')

const green = (t: string) => `\x1b[32m${t}\x1b[0m`
const red = (t: string) => `\x1b[31m${t}\x1b[0m`
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`

const live = process.argv.includes('--live')
let failures = 0

console.log('\n\x1b[1mApify\x1b[0m')

if (!config.apify.configured) {
  console.log(`  ${dim('·')} APIFY_API_TOKEN is not set — the pipeline runs on the bundled corpus.`)
  console.log(`    ${dim('Get one at https://console.apify.com/settings/integrations and put it in server/.env')}`)
} else {
  try {
    const me = await fetch(`${config.apify.baseUrl}/users/me`, {
      headers: { authorization: `Bearer ${config.apify.token}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!me.ok) throw new Error(`users/me returned ${me.status}`)
    const body = (await me.json()) as { data?: { username?: string; plan?: { id?: string } } }
    console.log(`  ${green('✓')} token valid — ${body.data?.username ?? 'unknown user'} ${dim(`(${body.data?.plan?.id ?? 'plan unknown'})`)}`)
  } catch (error) {
    failures += 1
    console.log(`  ${red('✗')} token rejected — ${error instanceof Error ? error.message : 'unknown'}`)
  }
}

console.log('\n\x1b[1mActors\x1b[0m')
for (const [label, actor] of [
  ['posts', config.apify.postsActor],
  ['hashtags', config.apify.hashtagActor],
  ['profiles', config.apify.profileActor],
] as const) {
  const [owner, name] = actor.split('~')
  try {
    const page = await fetch(`https://apify.com/${owner}/${name}.md`, { signal: AbortSignal.timeout(15_000) })
    if (page.ok) console.log(`  ${green('✓')} ${label.padEnd(9)} ${actor}`)
    else {
      failures += 1
      console.log(`  ${red('✗')} ${label.padEnd(9)} ${actor} — Store returned ${page.status}. Does this actor exist?`)
    }
  } catch (error) {
    console.log(`  ${dim('·')} ${label.padEnd(9)} ${actor} — could not reach the Store (${error instanceof Error ? error.message : 'network'})`)
  }
}

if (live && config.apify.configured && failures === 0) {
  console.log('\n\x1b[1mLive search\x1b[0m ' + dim('(capped at 3 results — pay-per-result)'))
  try {
    const posts = await apifyPostSearch.run({
      keyword: 'reinforcement learning',
      maxItems: 3,
      datePosted: 'past-week',
      sortBy: 'date',
      minAuthorFollowers: 0,
    })
    for (const post of posts) {
      console.log(`  ${green('✓')} ${post.authorName} — ${post.text.slice(0, 60).replace(/\s+/g, ' ')}…`)
      console.log(`    ${dim(post.url)}  ${dim(`${post.reactions} reactions · ${post.hashtags.map((h) => `#${h}`).join(' ') || 'no hashtags'}`)}`)
    }
  } catch (error) {
    failures += 1
    console.log(`  ${red('✗')} live search failed — ${error instanceof Error ? error.message : 'unknown'}`)
  }
} else if (live) {
  console.log(`\n  ${dim('· skipping live search — fix the above first')}`)
}

console.log('')
if (failures === 0) console.log(green('apify probe ok'))
else {
  console.log(red(`apify probe failed`) + ` — ${failures} problem(s)`)
  process.exit(1)
}
