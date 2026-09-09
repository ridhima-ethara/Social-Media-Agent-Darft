# Ethara SocialAI

An end-to-end, multi-agent social-media operations platform for a frontier AI research lab.

Twelve agents in seven stages. Eleven of them are specialists that hand work to each other along a
declared graph. The twelfth is **the command plane** — the command layer the human actually talks to, which
narrates on the others' behalf, asks before anything irreversible, and remembers.

The whole product runs with a **completely empty `.env`**, and every screen still renders with the
API server stopped. That is a design constraint, not a demo trick.

---

## Setup, in five commands

```bash
git clone <this repo> && cd main-sma
npm run setup          # installs both tiers, starts Postgres, migrates and seeds
npm run dev:full       # API on :4000, web app on :5173
```

`npm run setup` runs `docker compose up -d db`, waits for the health check, then migrates and seeds.
Open <http://localhost:5173> and you land on the sign-in screen.

**No Docker?** The web app is fully usable on its own:

```bash
npm install
npm run dev
```

It hydrates from the bundled dataset, says so in a banner, and Ethara answers on the in-bundle
deterministic parser.

---

## What you can do in the first two minutes

1. **Sign in as Marketing.** Any password. The boot sequence reads the real counts from state.
2. **Press ⌘K** and type *"what's trending this week?"* — Ethara shows you the plan before it runs it.
3. **Start discovery.** The Pipeline Theater runs scrape → validate → plan on a virtual clock; Space
   pauses it exactly where it is.
4. **Open the Weekly Calendar.** Exactly ten cards per platform. Everything else is below in *More
   suggestions* with its rank — promote one and watch what it displaces.
5. **Open a card, edit the caption, then ask Ethara to "make it shorter and more CTO-focused."** The
   instruction wins over the brand guideline; the finding is raised alongside it, never silently
   resolved.
6. **Sign out and back in as Leadership.** Nothing publishes without both approvals, and a rejection
   cannot be submitted without a reason.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The web app on `:5173` |
| `npm run dev:server` | The API on `:4000` |
| `npm run dev:full` | Both, with interleaved logs |
| `npm run build` | Typecheck, then production build |
| `npm run typecheck` | `tsc -b` across web and shared |
| `npm run lint` | oxlint |
| `npm run agent:check` | The registry audit — every skill declared, every knob described, every tool handled |
| `npm run specs:build` | Regenerates `specs/` from the registry |
| `npm run verify` | Typecheck + lint + the acceptance script |
| `npm run db:migrate` / `db:seed` / `db:reset` | Schema and seed data |

---

## Architecture

```
shared/          The contract. Imported by BOTH tiers — change here first, always.
server/          Node 22 · Express 5 · PostgreSQL 17 · raw SQL, no ORM
src/             React 19 · Vite · Tailwind v4 · one Zustand store, no router
specs/           Generated from the registry. Never hand-edited.
```

**The registry is the single source of truth.** `shared/agent-registry.ts` declares 12 agents, 91
skills and 229 settings; `shared/tool-registry.ts` declares the 36 tools Ethara may call. Three
consumers read it — the server runtime, the UI, and the generated specs — so it cannot fork.

Full detail is in [`specs/architecture.md`](specs/architecture.md), and the working rules are in
[`CLAUDE.md`](CLAUDE.md).

### The pipeline

```
keywords → scrape LinkedIn → validate (4 verdicts, every one with a reason)
        → analyse into a consolidated top 25 → research into a cited Knowledge Base
        → plan a weekly calendar → write and illustrate → Marketing approval
        → Leadership approval → publish → measure → write the lesson back
```

Four platforms ship — LinkedIn, Instagram, X and Facebook (see `docs/decisions/ADR-006`). Four
numbers hold the shape of it: top **5** trending keywords, top **5** hashtags each, a
consolidated top **25**, and top **10** calendar slots per platform. All four are adjustable knobs in
Agent Studio.

---

## Configuration

Copy `server/.env.example` to `server/.env`. Every key may be left blank.

| Blank key | What happens |
|---|---|
| `APIFY_API_TOKEN` | LinkedIn scraping reads the bundled fixture corpus, stamped `fixture` |
| `FACEBOOK_ACCESS_TOKEN` (and the other platform tokens) | Publishing runs in demo mode; every receipt says so |
| `PARALLEL_API_KEY` | Research reads the bundled research corpus, with the reason on every entry |
| `GCP_API_KEY` | Captions come from the deterministic template writer |
| `GCP_API_KEY` + `Z_IMAGE_ENDPOINT` | Creatives render locally with the brand renderer |
| `ASSISTANT_MODEL_PROVIDER` | Ethara runs on the built-in grammar parser — blunter, fully working |

Every fallback is **labelled in the UI**, on the card it affected. The mode is always visible: the
health endpoint reports the database, the publish mode and the command plane provider, and the header, the
telemetry ticker and Settings all surface it.

### Apify — live LinkedIn trends

Set `APIFY_API_TOKEN` in `server/.env` (from <https://console.apify.com/settings/integrations>) and the
Scraping Agent runs live. The setup follows <https://apify.com/agents.md>: the token travels as
`Authorization: Bearer`, never in the query string; cost caps (`maxItems`) go in the query, never the
input body; a run that outgrows the synchronous window is started asynchronously and polled.

The default actors are the ones with documented output shapes:

| Job | Actor | Input |
|---|---|---|
| Keyword post search | `harvestapi~linkedin-post-search` | `searchQueries`, `maxPosts`, `sortBy`, `postedLimit` |
| Hashtag feed | same actor, query `#tag` | an independent volume reading |
| Competitor pages | `harvestapi~linkedin-company-posts` | `targetUrls`, `maxPosts` |

Every trending keyword and hashtag carries the URLs to open it: the LinkedIn content search or
hashtag feed, and the strongest post that carried it. They show on Content Intelligence, come back
from `GET /api/trends`, and export as CSV from `GET /api/trends.csv`.

```bash
npm run apify:probe            # token + actors, no paid run
npm run apify:probe -- --live  # plus one search capped at 3 results
```

`.mcp.json` registers Apify's MCP server for Claude Code, so an agent session can search the Store
and read an actor's input schema without leaving the terminal.

### Going live, agent by agent

`docs/live-data.md` lists, per agent, the connector and key that switches it from fixtures to live
data, what it costs, and what still has to be built for live publishing and analytics.
`docs/apify.md` covers the scraping side in detail, including how to run it on the free tier.

### Degradation

| Failure | Behaviour |
|---|---|
| API server down | The UI falls back to `src/data/demo.ts`. Every screen renders; Ethara runs on the in-bundle parser and labels itself standalone |
| PostgreSQL down | The API **refuses to start** and prints the fix. Silently serving fabricated data would be worse than failing loudly |
| A service key absent | Fixture path, stamped with a `fallbackReason` shown on the relevant card |
| Image model unreachable | `brand-svg` renders locally; the asset card says why |

---

## The rules that are enforced, not aspirational

- **Nothing is ever deleted.** Rejections keep their reason, duplicates link to their original,
  knowledge deactivates, ideas are withdrawn, drafts version.
- **Nothing publishes without two human approvals.** There is no setting that removes this.
- **The command plane never acts irreversibly without a stored, token-validated confirmation** — and resuming
  replays the *stored plan*, never a re-parse of what you said.
- **Every automated decision carries a plain-language reason naming its evidence.**
- **Every knob is visible in Agent Studio** with the description that explains it. A constant hidden
  in a handler is a defect.
- **A past run stays explainable after the knobs change**, because `skill_runs.config_used` records
  the resolved configuration for that exact execution.

---

## Accessibility and craft

- Dark and light themes, both complete. Theme is one attribute on `<html>`; no component hard-codes a
  colour.
- `prefers-reduced-motion` disables every animation and renders content instantly and completely —
  including the command plane's narration, which arrives whole rather than token by token.
- Every number uses `tabular-nums`. Every timestamp is relative.
- Voice input and output are feature-detected. Where the Web Speech API is absent, nothing in the UI
  references speech and the product is complete without it.

---

## Licence

Prototype. Not for production publishing without real platform credentials and a review of the
publishing adapter.
