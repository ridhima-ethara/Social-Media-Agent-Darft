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
npm run dev:full       # API on :4001, web app on :5173
```

`npm run setup` runs `docker compose up -d db`, waits for the health check, then migrates and seeds.
Open <http://localhost:5173> and you land on the sign-in screen.

**No Docker?** The web app is fully usable on its own:

```bash
npm install
npm run dev
```

Every screen renders empty and says why in its own copy, and Ethara answers on the in-bundle
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
| `npm run dev:server` | The API on `:4001` |
| `npm run dev:full` | Both, with interleaved logs |
| `npm run build` | Typecheck, then production build |
| `npm run typecheck` | `tsc -b` across web and shared |
| `npm test` | vitest — the config invariants and the single-home checks |
| `npm run test:py` | pytest — the Python tier's knob-rejection rules |
| `npm run lint` | oxlint |
| `npm run doctor` | The preflight diagnostic — answers "why won't this run?" before anything starts |
| `npm run agent:check` | The registry audit — every skill declared, every knob described, every tool handled |
| `npm run specs:build` | Regenerates `specs/` from the registry |
| `npm run verify` | Typecheck + lint + the acceptance script |
| `npm run db:migrate` / `db:seed` / `db:reset` | Schema and seed data |
| `npm run db:embed` | Embeds any row written while the embedder was unreachable |

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

Four platforms ship — LinkedIn, Instagram, X and Facebook (see `docs/decisions/ADR-006-facebook-in-scope.md`). Four
numbers hold the shape of it: top **5** trending keywords, top **5** hashtags each, a
consolidated top **25**, and top **5** calendar slots per platform. All four are adjustable knobs in
Agent Studio.

---

## Configuration

Copy `server/.env.example` to `server/.env`. Every key may be left blank.

| Blank key | What happens |
|---|---|
| `CLAUDE_CODE_BIN` (no Claude Code on the host) | Scraping cannot run: every platform reports itself unavailable, nothing is captured, and the run says so. There is no fallback scraper |
| Platform publishing credentials | None exist yet. `PUBLISH_MODE=live` refuses with a specific message; demo mode simulates every call and stamps `demo` permanently on the receipt |
| `PARALLEL_API_KEY` | Research reads the open web with crawl4ai instead, with the reason on every entry |
| `GCP_API_KEY` / `GCP_SERVICE_ACCOUNT_JSON` | Captions, calendar copy and analytics prose come from the deterministic template writer instead of Gemini |
| `MFLUX_PYTHON` | Nothing paints backgrounds; creatives render locally with the brand SVG renderer instead of FLUX.2 Klein |
| `ASSISTANT_MODEL_PROVIDER` | Ethara runs on the built-in grammar parser — blunter, fully working |
| `EMBEDDINGS_ENABLED=false` (or no Google credential) | Retrieval runs on the lexical scorer alone. Rows still store — they keep a `NULL` vector until `npm run db:embed` reaches them — so nothing is lost, only paraphrase recall |

Text generation runs on **Gemini** (`GCP_API_KEY` or `GCP_SERVICE_ACCOUNT_JSON`), with the
deterministic template writer as the floor beneath it when no Google credential is set. Whichever
writer produced an artefact is stamped on it, and `/api/health` reports the resolved provider.
`AGENT_MODEL_PROVIDER` governs the Python tier the same way, over Claude (`ANTHROPIC_API_KEY`) with
the deterministic pipeline beneath it.

Every fallback is **labelled in the UI**, on the card it affected. The mode is always visible: the
health endpoint reports the database, the publish mode and the command plane provider, and the header, the
telemetry ticker and Settings all surface it.

### Scraping — the Claude Bridge, one source adapter per platform

There is one scraper: the **Claude Bridge** (`server/src/bridges/claude-bridge/`, ADR-013/014/015).
Apify, Parallel (for capture) and the crawl4ai crawler are gone. The flow is:

```
Knowledge Base + Brand Voice + Keywords
                ↓
          Claude Bridge
                ↓
 LinkedIn | Instagram | Facebook | X
                ↓
          Scraping Agent
                ↓
 Topic + Date + Hashtags + Post URL + Platform   → Validation Agent → Calendar Agent
```

- **What it searches for** comes from the live Knowledge Base, the Ethara brand voice and topics,
  and the configured keywords. It runs at most 3 focused searches per platform, per run.
- **Each platform has its own source adapter**, chosen in `platform_trends.source_adapters` in
  `server/src/bridges/claude-bridge/config/bridge.config.json`. Every platform defaults to
  `claude_code`: a headless Claude Code session that may only run web search. Replacing one
  platform's source (for example with an official API adapter) is a config change plus an adapter,
  and the other platforms are untouched. Each platform module (`platforms/*.ts`) decides what counts
  as a post on that platform and how to date it.
- **Only verifiable posts are kept.** The date is decoded from the platform's own post id
  (LinkedIn activity id, X snowflake, Instagram shortcode). A post outside the recency window
  (default: the past week) or with no provable date is left out and counted. Each post and trend is
  labelled **trending today** (published on the current date) or from earlier in the week, and today's
  come first. Facebook post ids carry no
  date, so Facebook is skipped with that reason.
- **Relevance is computed.** A post must mention an Ethara keyword and clear the brand-relevance
  floor. Posts are grouped into trends, at most 5 posts per trend, newest first.
- **Nothing is fabricated or bypassed.** URLs come only from raw search results. There is no login,
  no CAPTCHA or rate-limit evasion, and no fetching of social pages. A search result states no
  engagement, so `metricsAvailable` is false and no figure is invented.

When scraping and validation finish, the app opens a **Discovery results** popup. It lists each post's
Topic, Date, Hashtags, Post URL and Platform, with the matched keyword, the trend reason and the
Validation Agent's verdict, newest first. It is recorded on the run as `summary.discoveryResults`,
announced with the `discovery.results` event, and can be reopened from the scraping panel
("View results"). An empty run shows each platform's own reason instead of rows.

The calendar then writes **today's and tomorrow's posts from the freshest trends**, today's first.
Every later date holds a topic in the Topic Queue. Search engines index social posts late (often by
days), so "today" is often thin; that is reported with the newest date seen, never filled in. The window is the `datePosted` knob on Sherlock's
capture skill in Agent Studio. Details: [the bridge README](server/src/bridges/claude-bridge/README.md).

### Analysis — the Social Media Listener (SocialFetch)

The Analysis Agent's `analysis.social.listen` answers **what is happening around Ethara.AI on its
own social channels, and what are people saying about it**. It reads Ethara.AI's LinkedIn
(`ethara-ai`), Instagram (`ethara.ai`), X (`@EtharaAi`) and Facebook (its `Ethara-AI` page) through
**SocialFetch**, its only data source (`SOCIALFETCH_API_KEY` in `server/secrets.env`).

- Engagement, rate, rankings and topics are computed. Unstated metrics stay unstated.
- Claude reads each comment's sentiment and feedback, and writes the insights from the computed
  facts.
- The report is shown on the Dashboard's **Analysis** card, and in full under Content Intelligence
  → AI Analysis. **Run listener** fetches it fresh.
- Every report states its sample size and the SocialFetch credits it cost. A run stops calling
  SocialFetch once credits run out.
- Spec: `packages/skills/social-media-listener/SKILL.md`. Decision record: ADR-017.

Every trending keyword and hashtag carries the URLs to open it, and the strongest page that carried
it. They show on Content Intelligence, come back from `GET /api/trends`, and export as CSV from
`GET /api/trends.csv`.

### Retrieval — pgvector beside the rows, not a second database

Every scraped page and every Knowledge Base entry is stored **with a 768-dimension
vector**, in the same PostgreSQL the rest of the product uses. `nomic-embed-text` produces them over
the Ollama daemon that already serves Qwen, so semantic retrieval adds no service, no key and no
egress.

It is a column, not a separate vector store, and that is the whole point. Every retrieval must filter
on metadata the row already carries — `active`, `category`, `confidence`, `workspace_id` — and a
standalone index cannot do that without holding a copy that drifts. `Brain.recall()` refusing an
inactive entry is what makes *"switch an entry off and generation changes"* true rather than
decorative, so the vector has to live beside the flag that governs it.

**Retrieval is hybrid, because the two scorers fail in opposite directions.** Lexical matching is
exact and explainable but cannot see a paraphrase, and measured against this corpus it *saturates* —
dozens of entries score a perfect 1.0 on a five-word query, so its ranking among them is arbitrary.
Vector matching finds "reinforcement learning from human feedback" from "RLHF" and ranks continuously,
but cannot tell you why in words. So both run, and **the lexical overlap supplies the operator-facing
reason**: a cosine of 0.71 is not a reason, `matched on "rubric", "reward"` is.

What this deliberately does not do is touch a threshold. `similarity()` in `shared/brand-voice.ts`
still governs caption ≤ 0.70, image ≤ 0.85 and dedupe at 0.72, because those are product invariants
`npm run verify` asserts and the seed data is built around. Cosine lives on a different scale, and
letting it near one of those numbers would silently change what the number means. Vectors improve
**recall** and nothing else.

```bash
ollama pull nomic-embed-text     # 768 dims, Apache-2.0, ~275MB
npm run db:embed                 # embeds anything written while the embedder was down
```

Rows are embedded **on write** — at capture for a scraped page, at insert for a knowledge entry — and
a failure there never costs the row: an unreachable embedder yields a `NULL` vector, the row lands
anyway, and `db:embed` picks it up later. `pgvector` needs a literal width for its HNSW index, so the
column is fixed at `vector(768)` and the model that produced each vector is recorded beside it —
comparing one model's vector against another's returns a confident number that means nothing, so a
change of embedder is a detectable condition rather than a silent corruption. `/api/health` reports
the embedder and how much of each table is actually embedded.

Needs the extension: `brew install pgvector`, or the `pgvector/pgvector:pg17` image instead of
`postgres:17-alpine`.

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
| Scrape | Sherlock | the Claude Bridge (`backend/tools/sources.py` calls its CLI once per run, platform-level discovery) |
| Validate | Dexter | keyword/hashtag scoring, four verdicts |
| Plan | Dora | weekly calendar slots |
| Create | SpongeBob, Minnie | captions (`qwen3.5:latest`) and images (`x/flux2-klein:latest` via mflux, brand layer always local SVG) |
| Ship | Mickey | two-stage approval, then dispatch |
| Measure | Jerry, Velma | baseline comparison, lesson write-back |

It reads its configuration from `server/.env` only — inherited through the Node spawn, not a
separate `backend/.env` — so `AGENT_MODEL_PROVIDER` and `ANTHROPIC_API_KEY` govern the Python
tier. Run it standalone with `backend/.venv/bin/python scripts/run-agents-api.py
"<keyword>"`, which holds the SSE connection open so closing a shell does not orphan the run (the
API kills the child process on client disconnect, by design). A full 8-agent run on Claude takes
roughly 9–12 minutes.

### Going live, agent by agent

`docs/live-data.md` lists, per agent, the connector and key it needs, what it costs, and what still
has to be built for live publishing and analytics.

### Degradation

| Failure | Behaviour |
|---|---|
| API server down | The UI falls back to `src/data/empty.ts` — deliberately empty, not a bundled dataset, because a plausible dashboard nothing measured would be fabricated evidence. Every screen renders and says what to do about it; Ethara runs on the in-bundle parser and labels itself standalone |
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
# Social-Media-Agent-Darft
# Social-Media-Agent-Darft
