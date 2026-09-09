/**
 * THE REGISTRATION BARREL
 *
 * Importing this module registers every skill handler with the runtime. One
 * import per agent, in pipeline order — the file structure *is* the roster.
 * It is imported once, at boot, immediately before `auditSkillCoverage()`, so
 * a critical skill with no handler stops the server rather than silently
 * skipping at run time.
 */

import '../assistant/handlers'
import '../scraping/handlers'
import '../validation/handlers'
import '../analysis/handlers'
import '../calendar/handlers'
import '../caption/handlers'
import '../image/handlers'
import '../review/handlers'
import '../knowledge/handlers'
import '../publishing/handlers'
import '../analytics/handlers'
import '../learning/handlers'

export { auditSkillCoverage, skillCoverage, registeredSkillIds } from '../runtime'
