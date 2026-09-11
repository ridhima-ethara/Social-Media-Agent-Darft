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
4. **Open the Weekly Calendar.** Exactly five cards per platform. Everything else is below in *More
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

The eight operator-facing specialist names are standardized without changing their permanent machine IDs:

| Display name | Role | Stable ID |
|---|---|---|
| Mickey | Publishing Agent | `publishing` |
| Sherlock | Scraping Agent | `scraping` |
| Dexter | Validation Agent | `validation` |
| Velma | Learning Agent | `learning` |
| SpongeBob | Content Agent | `caption` |
| Dora | Calendar Agent | `calendar` |
| Minnie | Image Agent | `image` |
| Jerry | Analytics Agent | `analytics` |

Four platforms ship — LinkedIn, Instagram, X and Facebook (see `docs/decisions/ADR-006`). Four
numbers hold the shape of it: top **5** trending keywords, top **5** hashtags each, a
consolidated top **25**, and top **5** calendar slots per platform. All four are adjustable knobs in
Agent Studio.

---

## Configuration

Copy `server/.env.example` to `server/.env`. Every key may be left blank.

| Blank key | What happens |
|---|---|
| `APIFY_API_TOKEN` | The four platform lanes fall back to crawl4ai — the same lanes, read through a search engine, which states no engagement figures. The trend score then runs on volume alone and says so on every keyword |
| `CRAWL4AI_PYTHON` | The open-web lane cannot run at all, and a platform lane has nothing to fall back to. With both keys blank, nothing is captured — there is no corpus behind either |
| Platform publishing credentials | None exist yet. `PUBLISH_MODE=live` refuses with a specific message; demo mode simulates every call and stamps `demo` permanently on the receipt |
| `PARALLEL_API_KEY` | Research reads the open web with crawl4ai instead, with the reason on every entry |
| `OLLAMA_BASE_URL` (with `AGENT_MODEL_PROVIDER=ollama`) | Captions, calendar copy and analytics prose come from the deterministic template writer instead of `qwen3.5:latest` |
| `MFLUX_PYTHON` | Ollama refuses image generation over HTTP, so nothing tries mflux; creatives render locally with the brand SVG renderer instead of FLUX.2 Klein |
| `ASSISTANT_MODEL_PROVIDER` | Ethara runs on the built-in grammar parser — blunter, fully working |

`GCP_API_KEY` is the hosted alternative to the two Ollama keys above — `TEXT_MODEL_PROVIDER=auto`
prefers whichever local model is configured over it, and `AGENT_MODEL_PROVIDER` never silently
falls back from one vendor to another: an unreachable named provider degrades straight to the
deterministic path and stamps the reason on the output.

Every fallback is **labelled in the UI**, on the card it affected. The mode is always visible: the
health endpoint reports the database, the publish mode and the command plane provider, and the header, the
telemetry ticker and Settings all surface it.

### Scraping — Apify for the platforms, crawl4ai for the open web

Two sources, one shape. Both answer the same `RawPost` contract in
`server/src/integrations/capture.ts`, and `captureFor(platform)` decides which one serves a lane, so
the source is a property of the configuration rather than of the code.

**Apify reads the platforms themselves.** One actor per lane, each slug env-overridable, because an
actor is a third-party artefact that can be deprecated or repriced without notice. Actors return real
reaction, comment and repost counts — which matters more than convenience: three of the four
components of `trend_score` are engagement maths, and they are inert without figures.

**crawl4ai reads the open web.** `CRAWL4AI_PYTHON` points at the interpreter of `backend/.venv`, and
the Scraping Agent spawns `backend/tools/crawl.py` as a sidecar — a headless browser is a local
process, not an endpoint. It is also the fallback for a platform lane when no Apify token is set.

Each keyword is captured once **per lane**:

| Lane | With `APIFY_API_TOKEN` | Without it |
|---|---|---|
| LinkedIn | actor post search — real engagement | `<keyword> site:linkedin.com`, no figures |
| Instagram | actor hashtag search — real engagement | `<keyword> site:instagram.com` — very little; Instagram is login-walled to a logged-out crawl |
| X | actor post search — real engagement | `<keyword> (site:x.com OR site:twitter.com)` |
| Facebook | actor post search — real engagement | `<keyword> site:facebook.com`; likewise thin |
| Open web | no actor — always crawl4ai | unscoped, platform domains excluded |

Three things this deliberately does **not** do. It does not invent engagement figures: a
search-indexed page states no reaction count, so `metricsAvailable` is false and the count fields
stay at zero meaning *not applicable*, never *performed badly*. It does not average those zeros into
a measured average either — the Validation Agent computes engagement, velocity and growth over the
metric-bearing rows only, drops the three weights from the divisor when a keyword has none, and
appends the caveat to `trendReason` so a volume-only score is never mistaken for a measured one. And
it does not fill an empty lane: Instagram returning nothing for a keyword is a real finding about
Instagram, and it is reported as one.

Every captured page is scored at capture against the brand topic set **and** the live Knowledge
Base, and anything aligning with neither is dropped with the count recorded. That score travels on
the record as `brandRelevance`, so the Validation Agent inherits the evidence rather than
re-deriving it.

```bash
# The open-web lane and the platform fallback:
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python -m playwright install chromium
# One lane, by hand:
backend/.venv/bin/python -m tools.crawl --keywords "RLHF" --platform linkedin --max-pages 3
```

Posts per keyword, the recency window and the ranking order are knobs on Sherlock's capture skill in
Agent Studio. `APIFY_MAX_ITEMS_PER_KEYWORD` caps them at the deployment level, because actors bill
per result and a slider must not be able to run up a bill.

Every trending keyword and hashtag carries the URLs to open it, and the strongest page that carried
it. They show on Content Intelligence, come back from `GET /api/trends`, and export as CSV from
`GET /api/trends.csv`.

### Two execution paths, honestly

`npm run dev:full` runs `server/src/orchestrator.ts` — the 12-agent, registry-driven pipeline
the UI talks to by default. There is a second, separate engine: `backend/`, a Python 3.14
tier with its own 8-agent roster (`backend/agents/__init__.py`) and its own sequencer
(`backend/workflows/social_media_workflow.py`), driven by `POST /api/agents/run` and the
"Run agents" action. Both read and write the same Postgres state; they are not the same code
path, and consolidating them is tracked as open work rather than pretended away.

The Python tier is where the local models live:

| Stage | Agent | What it does |
|---|---|---|
| Scrape | Sherlock | crawl4ai, headless Chromium, keyless — the Python tier has no Apify path |
| Validate | Dexter | keyword/hashtag scoring, four verdicts |
| Plan | Dora | weekly calendar slots |
| Create | SpongeBob, Minnie | captions (`qwen3.5:latest`) and images (`x/flux2-klein:latest` via mflux, brand layer always local SVG) |
| Ship | Mickey | two-stage approval, then dispatch |
| Measure | Jerry, Velma | baseline comparison, lesson write-back |

It reads its configuration from `server/.env` only — inherited through the Node spawn, not a
separate `backend/.env` — so `AGENT_MODEL_PROVIDER=ollama` and the `OLLAMA_*` keys above govern
both engines at once. Run it standalone with `backend/.venv/bin/python scripts/run-agents-api.py
"<keyword>"`, which holds the SSE connection open so closing a shell does not orphan the run (the
API kills the child process on client disconnect, by design). A full 8-agent run on Qwen takes
roughly 9–12 minutes.

### Going live, agent by agent

`docs/live-data.md` lists, per agent, the connector and key it needs, what it costs, and what still
has to be built for live publishing and analytics.

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
