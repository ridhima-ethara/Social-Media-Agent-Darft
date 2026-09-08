/**
 * THE REGISTRATION BARREL
 *
 * Importing this module registers every skill handler with the runtime. It is
 * imported once, at boot, immediately before `auditSkillCoverage()` — so a
 * critical skill with no handler stops the server rather than silently skipping
 * at run time.
 *
 * Import order does not matter: each module registers itself.
 */

import './discover'
import './assess'
import './plan'
import './create'
import './create-image'
import './research'
import './ship'
import './learn'
import './jarvis'

export { auditSkillCoverage, skillCoverage, registeredSkillIds } from '../runtime'
