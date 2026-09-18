/**
 * Lists the Buffer channels this token can publish to.
 *
 * Exists because the ids are opaque and the failure they cause is confusing: a
 * post to the wrong LinkedIn channel succeeds and lands in the wrong feed. Seeing
 * the list before publishing is the cheapest way to avoid that.
 *
 *   npm run buffer:channels
 */

import { config } from '../src/config'
import { listChannels, unavailableReason } from '../src/integrations/buffer'

async function main(): Promise<void> {
  const reason = unavailableReason()
  if (reason !== '') {
    console.error(`✗ ${reason}`)
    process.exit(1)
  }

  const channels = await listChannels()
  if (channels.length === 0) {
    console.error(
      '✗ This token reaches no channels. Connect them at buffer.com first — a token with no\n' +
        '  connected channel authenticates successfully and then has nowhere to post.',
    )
    process.exit(1)
  }

  console.log(`\n  ${channels.length} channel${channels.length === 1 ? '' : 's'} on this token:\n`)
  const byService = new Map<string, typeof channels>()
  for (const c of channels) {
    byService.set(c.service, [...(byService.get(c.service) ?? []), c])
  }

  for (const [service, list] of byService) {
    for (const c of list) {
      console.log(`    ${service.padEnd(10)} ${c.id}  ${c.name}${c.type === '' ? '' : `  [${c.type}]`}`)
    }
    // The ambiguous case is the whole reason this script exists.
    if (list.length > 1) {
      console.log(
        `    ${''.padEnd(10)} ⚠ ${list.length} ${service} channels — set ` +
          `BUFFER_PROFILE_ID_${service.toUpperCase()} in server/.env to the one you mean,\n` +
          `    ${''.padEnd(10)}   or publishing will refuse rather than guess which feed to post to.`,
      )
    }
  }

  const pinned = (['linkedin', 'instagram', 'x', 'facebook'] as const).filter(
    (p) => config.buffer.profileIdFor(p) !== '',
  )
  console.log(
    `\n  Pinned in server/.env: ${pinned.length === 0 ? 'none — all resolved from the token' : pinned.join(', ')}\n`,
  )
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
