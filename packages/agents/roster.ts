/**
 * THE ROSTER — assembled from one folder per agent, in pipeline order.
 *
 * The folder is the unit: spec + prompt + (on the server) handlers. Adding an
 * agent means adding a folder and a line here; `npm run agent:check` fails if
 * the folder's SKILLS drift from the registry or its handlers file is missing.
 */

import * as a01 from './01-assistant/index'
import * as a02 from './02-scraping/index'
import * as a03 from './03-validation/index'
import * as a04 from './04-analysis/index'
import * as a05 from './05-calendar/index'
import * as a06 from './06-caption/index'
import * as a07 from './07-image/index'
import * as a08 from './08-review/index'
import * as a09 from './09-knowledge/index'
import * as a10 from './10-publishing/index'
import * as a11 from './11-analytics/index'
import * as a12 from './12-learning/index'

export const AGENT_MODULES = [a01, a02, a03, a04, a05, a06, a07, a08, a09, a10, a11, a12] as const

export const AGENT_FOLDERS: readonly string[] = [
  '01-assistant',
  '02-scraping',
  '03-validation',
  '04-analysis',
  '05-calendar',
  '06-caption',
  '07-image',
  '08-review',
  '09-knowledge',
  '10-publishing',
  '11-analytics',
  '12-learning',
]
