-- ═══════════════════════════════════════════════════════════════════════════
-- ETHARA SOCIALAI · SCHEMA
--
-- Fully idempotent: safe to run repeatedly, and `npm run db:reset` runs it
-- twice in a row as a gate. Every statement is IF NOT EXISTS or guarded.
--
-- Two structural laws are encoded here:
--   · Nothing is ever deleted. Rejections keep their reason, duplicates link to
--     their original, knowledge deactivates rather than vanishing, drafts
--     version rather than overwrite, metrics append rather than overwrite.
--   · A past run stays explainable after the knobs change, because
--     skill_runs.config_used stores the fully resolved config for that run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════════
-- pgvector — SEMANTIC RETRIEVAL, IN THE DATABASE WE ALREADY RUN
--
-- Not a separate vector store. Every retrieval must filter on the metadata the
-- rows already carry — `active`, `category`, `confidence`, `workspace_id` — and
-- a standalone index cannot do that without holding a copy of those columns
-- that then drifts. `Brain.recall()` refusing an inactive entry is what makes
-- "switch an entry off and generation changes" true rather than decorative, so
-- the vector has to live beside the flag that governs it.
--
-- 768 DIMENSIONS, FIXED. That is `nomic-embed-text`, the default embedder.
-- pgvector needs a literal dimension at DDL time for an HNSW index to exist, so
-- this cannot be an environment variable. The model that produced each vector is
-- recorded on the row instead, so swapping embedders is a detectable condition
-- that re-embeds rather than a silent comparison of incompatible spaces.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- ── workspaces ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  brand_voice TEXT,
  audience    TEXT,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── keywords ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keywords (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  term         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Core',
  weight       SMALLINT NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
  active       BOOLEAN NOT NULL DEFAULT true,
  -- ── Where this term came from (ADR-012) ──────────────────────────────────
  -- 'seeded'     — a human typed it, or the seed wrote it.
  -- 'discovered' — the platform extracted it from a captured corpus.
  --
  -- Recorded permanently, and not cosmetically: once discovered terms flow into
  -- the trend ranking, "is this trending because we chose to watch it, or
  -- because the corpus surfaced it" is a question an operator will ask about
  -- every row on the screen, and a column is the only honest way to answer it.
  origin       TEXT NOT NULL DEFAULT 'seeded' CHECK (origin IN ('seeded','discovered')),
  discovered_at     TIMESTAMPTZ,
  -- The sentence naming the posts and figures that produced the candidate.
  -- Rule 6: an automated decision carries a plain-language reason.
  discovery_reason  TEXT,
  discovery_run_id  UUID,
  -- 0-100, from the same axes the trend scorer uses.
  emergence_score   SMALLINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS keywords_workspace_term_key
  ON keywords (workspace_id, lower(term));
CREATE INDEX IF NOT EXISTS keywords_workspace_active_idx
  ON keywords (workspace_id, active, weight DESC);

-- ── keyword_signals · one row per keyword per run ──────────────────────────
CREATE TABLE IF NOT EXISTS keyword_signals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword_id       UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  run_id           UUID,
  post_count       INTEGER NOT NULL DEFAULT 0,
  total_engagement INTEGER NOT NULL DEFAULT 0,
  avg_engagement   NUMERIC(10,2) NOT NULL DEFAULT 0,
  velocity         NUMERIC(10,2) NOT NULL DEFAULT 0,
  growth_pct       NUMERIC(6,2) NOT NULL DEFAULT 0,
  trend_score      SMALLINT NOT NULL DEFAULT 0 CHECK (trend_score >= 0 AND trend_score <= 100),
  rank             SMALLINT,
  is_trending      BOOLEAN NOT NULL DEFAULT false,
  trend_reason     TEXT,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS keyword_signals_workspace_captured_idx
  ON keyword_signals (workspace_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS keyword_signals_keyword_captured_idx
  ON keyword_signals (keyword_id, captured_at DESC);

-- ── sources ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('linkedin','instagram','x','facebook','web')),
  source_type  TEXT NOT NULL CHECK (source_type IN ('Social','News','Competitor','Community','Website')),
  url          TEXT,
  trusted      BOOLEAN NOT NULL DEFAULT false,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sources_workspace_name_key
  ON sources (workspace_id, name);

-- ── hashtags ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hashtags (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tag                 TEXT NOT NULL,
  display_tag         TEXT NOT NULL,
  keyword_id          UUID REFERENCES keywords(id) ON DELETE SET NULL,
  run_id              UUID,
  post_count          INTEGER NOT NULL DEFAULT 0,
  total_engagement    INTEGER NOT NULL DEFAULT 0,
  engagement_per_post NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Mean brand alignment of the pages carrying the tag. On a corpus with no
  -- stated engagement this is what ranking actually runs on.
  brand_relevance     SMALLINT NOT NULL DEFAULT 0,
  -- Which lanes surfaced it; 'open-web' for the unscoped tier.
  platforms           TEXT[] NOT NULL DEFAULT '{}',
  relevance           SMALLINT NOT NULL DEFAULT 0,
  credibility         TEXT NOT NULL DEFAULT 'Medium' CHECK (credibility IN ('High','Medium','Low')),
  freshness           SMALLINT NOT NULL DEFAULT 0,
  hashtag_score       SMALLINT NOT NULL DEFAULT 0,
  rank                SMALLINT,
  validation          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (validation IN ('pending','validated','needs_review','duplicate','rejected')),
  verdict_reason      TEXT,
  -- A duplicate is LINKED, never deleted.
  duplicate_of_id     UUID REFERENCES hashtags(id) ON DELETE SET NULL,
  in_top_set          BOOLEAN NOT NULL DEFAULT false,
  researched_at       TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hashtags_workspace_tag_run_key
  ON hashtags (workspace_id, tag, run_id);
CREATE INDEX IF NOT EXISTS hashtags_workspace_validation_idx
  ON hashtags (workspace_id, validation);
CREATE INDEX IF NOT EXISTS hashtags_workspace_topset_idx
  ON hashtags (workspace_id, in_top_set, rank);

-- ── scraped_items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scraped_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id        UUID REFERENCES sources(id) ON DELETE SET NULL,
  keyword_id       UUID REFERENCES keywords(id) ON DELETE SET NULL,
  run_id           UUID,
  external_id      TEXT,
  title            TEXT NOT NULL,
  snippet          TEXT,
  url              TEXT,
  source_name      TEXT,
  source_type      TEXT,
  author_name      TEXT,
  author_headline  TEXT,
  author_followers INTEGER,
  hashtags         TEXT[] NOT NULL DEFAULT '{}',
  engagement       INTEGER NOT NULL DEFAULT 0,
  reactions        INTEGER NOT NULL DEFAULT 0,
  comments         INTEGER NOT NULL DEFAULT 0,
  reposts          INTEGER NOT NULL DEFAULT 0,
  relevance        SMALLINT NOT NULL DEFAULT 0,
  credibility      TEXT NOT NULL DEFAULT 'Medium' CHECK (credibility IN ('High','Medium','Low')),
  freshness        SMALLINT NOT NULL DEFAULT 0,
  is_duplicate     BOOLEAN NOT NULL DEFAULT false,
  duplicate_of_id  UUID REFERENCES scraped_items(id) ON DELETE SET NULL,
  validation       TEXT NOT NULL DEFAULT 'pending'
                   CHECK (validation IN ('pending','validated','needs_review','duplicate','rejected')),
  verdict_reason   TEXT,
  -- Which implementation produced this row. Surfaced in the UI, always.
  capture_source   TEXT NOT NULL DEFAULT 'fixture' CHECK (capture_source IN ('live','fixture')),
  -- Which platform lane captured it. NULL is the open-web lane and is a real
  -- value, not a missing one — hence no default and no NOT NULL.
  platform         TEXT CHECK (platform IN ('linkedin','instagram','x','facebook')),
  -- Whether the source stated engagement figures. FALSE is what makes the four
  -- count columns above readable as "not applicable" rather than as zero: a
  -- search-indexed page has no reaction count, and never had one.
  metrics_available BOOLEAN NOT NULL DEFAULT false,
  -- ── Views · a THIRD state, not a fourth count ────────────────────────────
  -- Views are stated by video actors (Instagram Reels, YouTube-shaped feeds)
  -- and by nothing else. A LinkedIn text post has no view count and never had
  -- one; an open-web citation has no view count and never had one. Neither is
  -- a video nobody watched.
  --
  -- So views get their OWN availability flag rather than riding
  -- `metrics_available`: a reel can state reactions and no plays, and a post
  -- can state reactions with views being structurally inapplicable. Collapsing
  -- the two would make `views = 0` mean three different things.
  --
  -- Every view-derived figure — the trend weight, the high-signal flag, the
  -- minimum-views filter — runs over `views_available` rows only (ADR-009).
  views            INTEGER NOT NULL DEFAULT 0,
  views_available  BOOLEAN NOT NULL DEFAULT false,
  -- ── The fields the content-scraper specification asks to collect ─────────
  -- The opening line, as the post itself opened. Stored rather than re-derived
  -- on read, because `snippet` is clamped for display and the hook is the one
  -- part of a post that is judged on its own.
  hook             TEXT,
  -- (reactions + comments) / views, as a percentage.
  --
  -- NULLABLE, and that is load-bearing. The rate needs BOTH a play count and a
  -- reaction count; a post stating one and not the other has no engagement
  -- rate, which is different from having a rate of zero. A 0 here would mean a
  -- post that was seen and ignored — a real and much worse finding.
  engagement_rate  NUMERIC,
  -- reel | short | video | post | article. What KIND of thing it is, which the
  -- specification asks for and which a platform name alone cannot answer: an
  -- Instagram Reel and an Instagram photo distribute differently.
  media_format     TEXT,
  -- Flags the Validation Agent raised — 'VIRAL', 'high-signal-views',
  -- 'viral-er'. Stored rather than re-derived on read: the thresholds are
  -- operator knobs, so a flag computed in a screen would drift the moment
  -- someone changed one, and the run's own decision is the honest record.
  signal_flags     TEXT[] NOT NULL DEFAULT '{}',
  -- ── Transcript · NULL is "not transcribed", never "said nothing" ─────────
  -- Produced by `scraping.transcript.fetch` through the local Whisper sidecar
  -- (ADR-011). With WHISPER_PYTHON unset nothing spawns and this stays NULL,
  -- and no consumer may read a NULL transcript as an empty one.
  --
  -- A transcript is SCRAPED CONTENT. It passes `prepareEvidence()` before it
  -- reaches any model, exactly as a scraped body does.
  transcript            TEXT,
  transcript_source     TEXT,
  transcript_confidence NUMERIC,
  -- How well the body aligned with the brand topics and the Knowledge Base,
  -- scored at capture. Anything below the run's floor never became a row.
  brand_relevance  SMALLINT NOT NULL DEFAULT 0,
  posted_at        TIMESTAMPTZ,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at     TIMESTAMPTZ,
  -- ── Semantic retrieval ──────────────────────────────────────────────────
  -- NULL means "not embedded yet", which is a first-class state: the embedder
  -- is an external service, and a capture must never be lost because it was
  -- unreachable. `npm run db:embed` picks these up later.
  embedding        vector(768),
  -- Which model produced the vector above. Recorded so a change of embedder is
  -- detectable: comparing a vector from one model against another's is
  -- meaningless, and would return confident nonsense rather than an error.
  embedding_model  TEXT,
  embedded_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS scraped_items_workspace_scraped_idx
  ON scraped_items (workspace_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS scraped_items_workspace_validation_idx
  ON scraped_items (workspace_id, validation);
-- The per-platform breakdown the console renders is a filter on this.
CREATE INDEX IF NOT EXISTS scraped_items_workspace_platform_idx
  ON scraped_items (workspace_id, platform);
-- Unique, not merely indexed: a re-run must UPDATE the item it already captured
-- rather than stack a second copy. This is the conflict target `persistScrapedItems`
-- upserts on.
CREATE UNIQUE INDEX IF NOT EXISTS scraped_items_workspace_external_key
  ON scraped_items (workspace_id, external_id);

-- ── content_ideas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_ideas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_item_id        UUID REFERENCES scraped_items(id) ON DELETE SET NULL,
  hashtag_id            UUID REFERENCES hashtags(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  source_topic          TEXT,
  platform              TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x','facebook')),
  alt_platforms         JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_date        DATE NOT NULL,
  scheduled_time        TEXT NOT NULL DEFAULT '10:30 AM',
  confidence            SMALLINT NOT NULL DEFAULT 0,
  priority_score        SMALLINT NOT NULL DEFAULT 0,
  platform_rank         SMALLINT,
  -- The top-10-per-platform rule: only 'primary' ideas take a calendar slot.
  calendar_slot         TEXT NOT NULL DEFAULT 'suggestion'
                        CHECK (calendar_slot IN ('primary','suggestion')),
  status                TEXT NOT NULL DEFAULT 'suggested'
                        CHECK (status IN ('suggested','drafted','in_review','pending_leadership',
                                          'approved','scheduled','published','rejected')),
  -- Which KIND of artefact this idea becomes (ADR-007). Defaults to 'post', so
  -- every row written before the column existed is valid without a backfill.
  -- A 'short_form_script' idea terminates at export and is refused by the
  -- publish path (ADR-010).
  content_format        TEXT NOT NULL DEFAULT 'post'
                        CHECK (content_format IN ('post','short_form_script')),
  analysis              JSONB NOT NULL DEFAULT '{}'::jsonb,
  feedback              JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_new_trend          BOOLEAN NOT NULL DEFAULT false,
  marketing_approved_by TEXT,
  marketing_approved_at TIMESTAMPTZ,
  leadership_decision   JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_ideas_workspace_date_idx
  ON content_ideas (workspace_id, scheduled_date);
CREATE INDEX IF NOT EXISTS content_ideas_workspace_rank_idx
  ON content_ideas (workspace_id, platform, calendar_slot, platform_rank);
CREATE INDEX IF NOT EXISTS content_ideas_workspace_status_idx
  ON content_ideas (workspace_id, status);

-- ── drafts · upsert increments revision, never overwrites blindly ───────────
CREATE TABLE IF NOT EXISTS drafts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id      UUID NOT NULL REFERENCES content_ideas(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x','facebook')),
  body         TEXT NOT NULL,
  -- Mirrors `content_ideas.content_format`. Carried on the draft as well as the
  -- idea because the review screens read a draft without its idea, and a
  -- beat-structured script rendered as though it were a caption is a silent
  -- category error rather than a visible one.
  content_format TEXT NOT NULL DEFAULT 'post'
                 CHECK (content_format IN ('post','short_form_script')),
  revision     INTEGER NOT NULL DEFAULT 1,
  generated_by TEXT,
  model        TEXT,
  source       TEXT NOT NULL DEFAULT 'fixture' CHECK (source IN ('live','fixture')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS drafts_idea_platform_key
  ON drafts (idea_id, platform);

-- ── media_assets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id         UUID NOT NULL REFERENCES content_ideas(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x','facebook')),
  kind            TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('single','carousel')),
  concept         TEXT,
  canvas          TEXT,
  width           INTEGER,
  height          INTEGER,
  alt_text        TEXT,
  render_mode     TEXT NOT NULL DEFAULT 'demo' CHECK (render_mode IN ('demo','live')),
  model           TEXT NOT NULL DEFAULT 'brand-svg',
  prompt          TEXT,
  fallback_reason TEXT,
  data_uri        TEXT NOT NULL,
  variants        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_idea_platform_key
  ON media_assets (idea_id, platform);

-- ── posts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idea_id                 UUID REFERENCES content_ideas(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  platform                TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x','facebook')),
  content                 TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'published'
                          CHECK (status IN ('published','failed','scheduled')),
  external_id             TEXT,
  -- Demo and live are never mixed, and the mode is permanent on the receipt.
  publish_mode            TEXT NOT NULL DEFAULT 'demo' CHECK (publish_mode IN ('demo','live')),
  published_at            DATE,
  history                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  media_asset_id          UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  analysis_summary        TEXT,
  analysis_recommendation TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One receipt, one row. Publishing is irreversible, so a duplicate dispatch --
-- a retried request, a double-clicked button, two concurrent calls -- must not
-- be able to record itself twice. Partial, because external_id is NULL until a
-- dispatch actually returns one and several NULLs are not a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS posts_workspace_external_id_key
  ON posts (workspace_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS posts_workspace_published_idx
  ON posts (workspace_id, published_at DESC);

-- ── post_metrics · a row per pull, never overwritten ───────────────────────
CREATE TABLE IF NOT EXISTS post_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reach           INTEGER NOT NULL DEFAULT 0,
  impressions     INTEGER NOT NULL DEFAULT 0,
  likes           INTEGER NOT NULL DEFAULT 0,
  comments        INTEGER NOT NULL DEFAULT 0,
  shares          INTEGER NOT NULL DEFAULT 0,
  engagement_rate NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS post_metrics_post_captured_idx
  ON post_metrics (post_id, captured_at DESC);

-- ── platform_analytics ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_analytics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x','facebook')),
  month        TEXT NOT NULL,
  label        TEXT,
  -- An unreported period is EXCLUDED from averages, never counted as zero.
  is_reported  BOOLEAN NOT NULL DEFAULT false,
  metrics      JSONB NOT NULL DEFAULT '{}'::jsonb,
  daily        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_analytics_key
  ON platform_analytics (workspace_id, platform, month);

-- ── knowledge_builds ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_builds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger             TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('cron','manual','assistant')),
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  hashtags_researched INTEGER NOT NULL DEFAULT 0,
  entries_written     INTEGER NOT NULL DEFAULT 0,
  entries_merged      INTEGER NOT NULL DEFAULT 0,
  sources_cited       INTEGER NOT NULL DEFAULT 0,
  research_source     TEXT NOT NULL DEFAULT 'fixture' CHECK (research_source IN ('live','fixture')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  summary             JSONB NOT NULL DEFAULT '{}'::jsonb,
  error               TEXT
);

CREATE INDEX IF NOT EXISTS knowledge_builds_workspace_started_idx
  ON knowledge_builds (workspace_id, started_at DESC);

-- ── knowledge_entries · deactivate, never delete ───────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'Research',
  content        TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'Manual entry',
  -- The cited URLs. An entry citing fewer than minSources never gets here.
  sources        JSONB NOT NULL DEFAULT '[]'::jsonb,
  hashtag_id     UUID REFERENCES hashtags(id) ON DELETE SET NULL,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  confidence     TEXT NOT NULL DEFAULT 'Medium' CHECK (confidence IN ('High','Medium','Low')),
  evidence_count INTEGER NOT NULL DEFAULT 1,
  active         BOOLEAN NOT NULL DEFAULT true,
  origin         TEXT NOT NULL DEFAULT 'manual'
                 CHECK (origin IN ('brand','research','learned','manual','assistant')),
  build_id       UUID REFERENCES knowledge_builds(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ── Semantic retrieval ────────────────────────────────────────────────────
  -- See the pgvector note at the top of this file. NULL means "not embedded
  -- yet"; an entry is never withheld from the store because the embedder was
  -- down, it simply retrieves lexically until `npm run db:embed` reaches it.
  embedding      vector(768),
  embedding_model TEXT,
  embedded_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS knowledge_entries_workspace_active_idx
  ON knowledge_entries (workspace_id, active);
CREATE INDEX IF NOT EXISTS knowledge_entries_workspace_category_idx
  ON knowledge_entries (workspace_id, category);

-- ── agent_skills · per-workspace knob overrides ────────────────────────────
CREATE TABLE IF NOT EXISTS agent_skills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_workspace_skill_key
  ON agent_skills (workspace_id, skill_id);

-- ── agent_state ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_state (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'idle'
               CHECK (status IN ('idle','running','completed','waiting','needs_review','failed')),
  current_task TEXT NOT NULL DEFAULT 'Idle',
  last_run     TIMESTAMPTZ,
  processed    INTEGER NOT NULL DEFAULT 0,
  success_rate SMALLINT NOT NULL DEFAULT 100,
  PRIMARY KEY (workspace_id, agent_id)
);

-- ── pipeline_runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL DEFAULT 'manual',
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  -- The command plane turn that started this, when it was not a schedule or a click.
  turn_id      UUID,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS pipeline_runs_workspace_started_idx
  ON pipeline_runs (workspace_id, started_at DESC);

-- ── agent_runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','completed','failed')),
  trigger         TEXT NOT NULL DEFAULT 'manual',
  turn_id         UUID,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  input_count     INTEGER NOT NULL DEFAULT 0,
  output_count    INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_workspace_started_idx
  ON agent_runs (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_pipeline_idx
  ON agent_runs (pipeline_run_id);

-- ── skill_runs · config_used is what keeps a past run explainable ──────────
CREATE TABLE IF NOT EXISTS skill_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  skill_id     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('completed','skipped','failed')),
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  -- The fully resolved config for this exact run.
  config_used  JSONB NOT NULL DEFAULT '{}'::jsonb,
  note         TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_runs_workspace_started_idx
  ON skill_runs (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS skill_runs_workspace_skill_idx
  ON skill_runs (workspace_id, skill_id, started_at DESC);
CREATE INDEX IF NOT EXISTS skill_runs_agent_run_idx
  ON skill_runs (agent_run_id);

-- ── activity_events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     TEXT,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','running','warn','error')),
  entity_type  TEXT,
  entity_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_workspace_created_idx
  ON activity_events (workspace_id, created_at DESC);

-- ── review_queue · the escalation contract, as rows ────────────────────────
CREATE TABLE IF NOT EXISTS review_queue (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('scraped_item','hashtag','knowledge_conflict')),
  entity_id          UUID,
  -- Naming the specific evidence. "Low confidence" alone is a bug.
  reason             TEXT NOT NULL,
  decision_requested TEXT NOT NULL,
  options            TEXT[] NOT NULL DEFAULT '{}',
  resolved           BOOLEAN NOT NULL DEFAULT false,
  resolved_by        TEXT,
  resolved_at        TIMESTAMPTZ,
  outcome            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_queue_workspace_resolved_idx
  ON review_queue (workspace_id, resolved, created_at DESC);

-- ── lineage_edges ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineage_edges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_type    TEXT NOT NULL,
  from_id      UUID NOT NULL,
  to_type      TEXT NOT NULL,
  to_id        UUID NOT NULL,
  agent_id     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lineage_edges_from_idx
  ON lineage_edges (workspace_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS lineage_edges_to_idx
  ON lineage_edges (workspace_id, to_type, to_id);
CREATE UNIQUE INDEX IF NOT EXISTS lineage_edges_unique
  ON lineage_edges (workspace_id, from_type, from_id, to_type, to_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Ethara · the command plane's own record
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('marketing','leadership')),
  title        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_workspace_last_idx
  ON assistant_conversations (workspace_id, last_at DESC);

CREATE TABLE IF NOT EXISTS assistant_turns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  speaker         TEXT NOT NULL CHECK (speaker IN ('operator','assistant')),
  utterance       TEXT,
  channel         TEXT NOT NULL DEFAULT 'text' CHECK (channel IN ('text','voice','ambient','cron')),
  intent          JSONB,
  plan            JSONB,
  narration       TEXT,
  confidence      SMALLINT,
  status          TEXT NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning','awaiting_confirmation','running',
                                    'completed','failed','cancelled')),
  -- The pronoun resolution target: what "it" refers to on the next turn.
  last_entity     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_turns_conversation_seq_idx
  ON assistant_turns (conversation_id, seq);

CREATE TABLE IF NOT EXISTS assistant_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id        UUID NOT NULL REFERENCES assistant_turns(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  tool_id        TEXT NOT NULL,
  risk           TEXT NOT NULL DEFAULT 'safe' CHECK (risk IN ('safe','mutating','irreversible')),
  args           JSONB NOT NULL DEFAULT '{}'::jsonb,
  why            TEXT,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','completed','failed','skipped')),
  result_summary TEXT,
  result         JSONB,
  duration_ms    INTEGER,
  agent_run_id   UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  error          TEXT,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS assistant_steps_turn_idx
  ON assistant_steps (turn_id, idx);

CREATE TABLE IF NOT EXISTS assistant_confirmations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id     UUID NOT NULL REFERENCES assistant_turns(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  -- The STORED plan. Resuming runs this, never a re-parse of the utterance,
  -- so what the human approved is exactly what executes.
  plan        JSONB NOT NULL,
  prompt      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  decided     TEXT CHECK (decided IN ('confirmed','cancelled','expired')),
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_confirmations_turn_idx
  ON assistant_confirmations (turn_id);

CREATE TABLE IF NOT EXISTS assistant_briefs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger        TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('cron','manual')),
  signals        JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendation TEXT,
  narration      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_briefs_workspace_created_idx
  ON assistant_briefs (workspace_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- FORWARD-COMPATIBILITY GUARDS
--
-- These run harmlessly on a fresh database and repair one created by an
-- earlier build, so `db:reset` is safe against an existing volume.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE pipeline_runs   ADD COLUMN IF NOT EXISTS turn_id UUID;
ALTER TABLE agent_runs      ADD COLUMN IF NOT EXISTS turn_id UUID;
ALTER TABLE agent_runs      ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE content_ideas   ADD COLUMN IF NOT EXISTS calendar_slot TEXT NOT NULL DEFAULT 'suggestion';
ALTER TABLE content_ideas   ADD COLUMN IF NOT EXISTS platform_rank SMALLINT;
ALTER TABLE content_ideas   ADD COLUMN IF NOT EXISTS priority_score SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE hashtags        ADD COLUMN IF NOT EXISTS in_top_set BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hashtags        ADD COLUMN IF NOT EXISTS researched_at TIMESTAMPTZ;
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS build_id UUID;
ALTER TABLE scraped_items   ADD COLUMN IF NOT EXISTS capture_source TEXT NOT NULL DEFAULT 'fixture';
ALTER TABLE posts           ADD COLUMN IF NOT EXISTS publish_mode TEXT NOT NULL DEFAULT 'demo';

-- ── URLs on trend signals ──────────────────────────────────────────────────
-- A trending keyword or hashtag that cannot be opened is a claim, not a lead.
-- ADD COLUMN IF NOT EXISTS, so an existing database migrates in place.
ALTER TABLE hashtags        ADD COLUMN IF NOT EXISTS feed_url       TEXT;
ALTER TABLE hashtags        ADD COLUMN IF NOT EXISTS top_post_url   TEXT;
ALTER TABLE hashtags        ADD COLUMN IF NOT EXISTS top_post_title TEXT;
ALTER TABLE keyword_signals ADD COLUMN IF NOT EXISTS search_url     TEXT;
ALTER TABLE keyword_signals ADD COLUMN IF NOT EXISTS top_post_url   TEXT;
ALTER TABLE keyword_signals ADD COLUMN IF NOT EXISTS top_post_title TEXT;

-- How many of this keyword's posts actually carried engagement figures.
--
-- Without it `total_engagement = 0` is ambiguous, and the two readings are
-- opposite: a keyword whose posts were measured and drew no reactions, versus
-- a keyword captured entirely from search-indexed pages that state no figures
-- at all. The UI was rendering both as a literal 0, which reports the second
-- as though it had performed badly. Constraint 2: N/A is never 0.
ALTER TABLE keyword_signals ADD COLUMN IF NOT EXISTS measured_count INTEGER NOT NULL DEFAULT 0;

-- ── Facebook as a fourth platform (ADR-006) ────────────────────────────────
-- CREATE TABLE IF NOT EXISTS leaves an existing table's CHECK untouched, so the
-- constraint is re-created by name. Idempotent: safe to run on every migrate.
ALTER TABLE sources ALTER COLUMN kind DROP NOT NULL;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_kind_check;
ALTER TABLE sources ADD CONSTRAINT sources_kind_check CHECK (kind IN ('linkedin','instagram','x','facebook','web'));
ALTER TABLE sources ALTER COLUMN kind SET NOT NULL;
ALTER TABLE content_ideas      DROP CONSTRAINT IF EXISTS content_ideas_platform_check;
ALTER TABLE content_ideas      ADD CONSTRAINT content_ideas_platform_check CHECK (platform IN ('linkedin','instagram','x','facebook'));
ALTER TABLE drafts             DROP CONSTRAINT IF EXISTS drafts_platform_check;
ALTER TABLE drafts             ADD CONSTRAINT drafts_platform_check CHECK (platform IN ('linkedin','instagram','x','facebook'));
ALTER TABLE media_assets       DROP CONSTRAINT IF EXISTS media_assets_platform_check;
ALTER TABLE media_assets       ADD CONSTRAINT media_assets_platform_check CHECK (platform IN ('linkedin','instagram','x','facebook'));
ALTER TABLE posts              DROP CONSTRAINT IF EXISTS posts_platform_check;
ALTER TABLE posts              ADD CONSTRAINT posts_platform_check CHECK (platform IN ('linkedin','instagram','x','facebook'));
ALTER TABLE platform_analytics DROP CONSTRAINT IF EXISTS platform_analytics_platform_check;
ALTER TABLE platform_analytics ADD CONSTRAINT platform_analytics_platform_check CHECK (platform IN ('linkedin','instagram','x','facebook'));

-- ── Semantic retrieval columns and indexes (pgvector) ──────────────────────
-- The columns are declared inline in the CREATE TABLE bodies above, which only
-- takes effect on a database being built from scratch. These ALTERs are what
-- reach a database that already exists — `CREATE TABLE IF NOT EXISTS` leaves an
-- existing table exactly as it was, so without them `findSchemaDrift()` would
-- report the new columns as drift and demand a destructive `--fresh` rebuild.
-- Adding them additively means an existing corpus keeps every captured row.
ALTER TABLE scraped_items     ADD COLUMN IF NOT EXISTS embedding       vector(768);
ALTER TABLE scraped_items     ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE scraped_items     ADD COLUMN IF NOT EXISTS embedded_at     TIMESTAMPTZ;
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS embedding       vector(768);
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS embedded_at     TIMESTAMPTZ;

-- A PUBLISHED POST IS WITHDRAWN FROM THE VIEW, NEVER DELETED.
--
-- Removing a post from the published section is an editorial decision, and the
-- row is the receipt for a real dispatch -- it still carries the external_id the
-- platform issued. Deleting it would destroy the only local evidence that the
-- dispatch happened, silently change every measured average computed from it,
-- and leave a live platform URL with nothing behind it. So the row stays and a
-- timestamp hides it, exactly as ideas are withdrawn and knowledge deactivates.
--
-- Withdrawing is NOT retraction. The post remains on the platform; only this
-- product stops presenting it. Reversing it is one UPDATE setting these to NULL.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS withdrawn_at     TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT;

-- A withdrawal must carry its reason, the same rule a rejection follows.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_withdrawn_reason_required;
ALTER TABLE posts ADD  CONSTRAINT posts_withdrawn_reason_required
  CHECK (withdrawn_at IS NULL OR withdrawn_reason IS NOT NULL);

-- HNSW over cosine distance. HNSW rather than IVFFlat because it needs no
-- training pass and stays correct as rows arrive one run at a time; cosine
-- because the embedder returns unnormalised vectors and cosine is the metric
-- `nomic-embed-text` was trained against.
--
-- A partial index: only rows that HAVE a vector belong in it. Most of the corpus
-- is unembedded the moment the feature ships, and indexing NULLs would cost
-- space to describe their absence.
CREATE INDEX IF NOT EXISTS scraped_items_embedding_idx
  ON scraped_items USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_entries_embedding_idx
  ON knowledge_entries USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Finding what still needs embedding must not scan the whole table.
CREATE INDEX IF NOT EXISTS scraped_items_unembedded_idx
  ON scraped_items (workspace_id) WHERE embedding IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_entries_unembedded_idx
  ON knowledge_entries (workspace_id) WHERE embedding IS NULL;

-- ── keyword_schedule · which keywords a given cycle week captures ───────────
-- A rotating rota of WEEKS, seeded from shared/keyword-schedule.ts and editable
-- thereafter. Two kinds of row, and the nullable `cycle_week` is what separates
-- them:
--
--   constant  cycle_week IS NULL  — captured every week, without exception
--   rotating  cycle_week = 1..N   — captured only during that week of the cycle
--
-- Held this way rather than repeating the constants across every week: that would
-- be N copies of each standing keyword which must all be edited together, and the
-- first time one was missed the trend series would break silently.
--
-- References `keywords(id)` rather than storing the term as text, because a
-- schedule row holding a string that no longer matches a keyword is a silent
-- no-op — the run would simply capture less and report nothing wrong.
CREATE TABLE IF NOT EXISTS keyword_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword_id   UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('constant','rotating')),
  cycle_week   SMALLINT CHECK (cycle_week IS NULL OR cycle_week BETWEEN 1 AND 260),
  -- What the week is about. Operator-facing only; never used for matching.
  topic        TEXT NOT NULL DEFAULT '',
  -- Ordering within a week, so a run that can only take N keywords takes the
  -- intended N rather than an arbitrary N.
  slot_rank    SMALLINT NOT NULL DEFAULT 1,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The two kinds are mutually exclusive by construction, so a 'constant' row
  -- cannot acquire a week and start behaving like a rotating one.
  CONSTRAINT keyword_schedule_kind_week CHECK (
    (kind = 'constant' AND cycle_week IS NULL) OR
    (kind = 'rotating' AND cycle_week IS NOT NULL)
  )
);

-- One row per keyword per week. `cycle_week` is NULL for constants, and NULLs are
-- distinct in a UNIQUE index, so constants are keyed separately below.
CREATE UNIQUE INDEX IF NOT EXISTS keyword_schedule_rotating_key
  ON keyword_schedule (workspace_id, cycle_week, keyword_id)
  WHERE cycle_week IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS keyword_schedule_constant_key
  ON keyword_schedule (workspace_id, keyword_id)
  WHERE cycle_week IS NULL;
CREATE INDEX IF NOT EXISTS keyword_schedule_week_idx
  ON keyword_schedule (workspace_id, cycle_week, slot_rank);

-- ═══════════════════════════════════════════════════════════════════════════
-- SHORT-FORM: VOICE PROFILES, HOOK VARIANTS, TRACKED ACCOUNTS
--
-- Four tables serving the short-form path (ADR-007 · 008 · 010). They obey the
-- same two structural laws as everything above: nothing is deleted, and a
-- derived claim carries the evidence it was derived from.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── voice_profiles · DERIVED, never hand-written ───────────────────────────
-- A profile is an OBSERVATION of stored samples, not an assertion about how
-- someone writes. That is why `sample_count` and `derived_at` are NOT NULL and
-- why the samples themselves are kept below: a profile that cannot be
-- re-derived is a claim with no evidence behind it.
--
-- `content_format` is NOT NULL and is the whole of ADR-008: a profile governs
-- exactly one kind of artefact. A profile derived from reel scripts is never
-- read by a caption skill, and the filter is in the SQL rather than in a
-- conditional that a later edit can drop.
--
-- Nothing here can raise the emoji budget. `enforceBrandVoice()` reads BRAND
-- and only BRAND, and there is no column below that it consults.
CREATE TABLE IF NOT EXISTS voice_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  content_format    TEXT NOT NULL DEFAULT 'short_form_script'
                    CHECK (content_format IN ('post','short_form_script')),
  -- How many samples produced it. Rendered beside every profile, because "a
  -- voice learned from 4 scripts" and "from 40" are different claims.
  sample_count      INTEGER NOT NULL,
  derived_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Observed, never asserted: term frequencies actually counted in the samples.
  vocabulary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  sentence_stats    JSONB NOT NULL DEFAULT '{}'::jsonb,
  structure_pattern JSONB NOT NULL DEFAULT '{}'::jsonb,
  cta_pattern       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Deactivated, never deleted — the same rule knowledge entries follow.
  active            BOOLEAN NOT NULL DEFAULT true,
  embedding         vector(768),
  embedding_model   TEXT,
  embedded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_profiles_workspace_format_idx
  ON voice_profiles (workspace_id, content_format, active);

-- ── voice_samples · the raw material, kept ─────────────────────────────────
-- Kept because a profile must be re-derivable and explainable. `profile_id` is
-- nullable: samples are pasted BEFORE a profile exists, and a later derivation
-- stamps them. A sample outlives the profile it produced.
CREATE TABLE IF NOT EXISTS voice_samples (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id     UUID REFERENCES voice_profiles(id) ON DELETE SET NULL,
  content_format TEXT NOT NULL DEFAULT 'short_form_script'
                 CHECK (content_format IN ('post','short_form_script')),
  body           TEXT NOT NULL,
  -- Where it came from: 'operator' for a paste, 'published' for our own post.
  source         TEXT NOT NULL DEFAULT 'operator',
  label          TEXT,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_samples_workspace_format_idx
  ON voice_samples (workspace_id, content_format, captured_at DESC);
CREATE INDEX IF NOT EXISTS voice_samples_profile_idx
  ON voice_samples (profile_id);

-- ── hook_variants · one ROW per variant, never a blob on the draft ─────────
-- One row each, because each variant carries its own pattern, its own matched
-- evidence and its own outcome. A JSON array on the draft could not be joined,
-- counted, or asked "which pattern wins for us".
--
-- `confidence` is NULLABLE and that is the load-bearing part. A confidence
-- score is a FACTUAL CLAIM. Where no comparable stored post exists, the correct
-- output is no score and a stated reason — not a default, not 5/10, not zero.
-- `confidence_basis` is NOT NULL either way: it names the evidence when there
-- is a score, and names the absence when there is not.
CREATE TABLE IF NOT EXISTS hook_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idea_id          UUID NOT NULL REFERENCES content_ideas(id) ON DELETE CASCADE,
  draft_id         UUID REFERENCES drafts(id) ON DELETE SET NULL,
  body             TEXT NOT NULL,
  pattern          TEXT NOT NULL CHECK (pattern IN
                     ('aspirational','pain_point','insider','specific_claim','curiosity_gap')),
  rank             SMALLINT NOT NULL DEFAULT 1,
  -- 0-100, or NULL for "not derivable from anything stored".
  confidence       NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  confidence_basis TEXT NOT NULL,
  -- The stored post this hook resembles, when one was found. NULL is a real
  -- value: it is exactly the case where `confidence` must also be NULL.
  matched_post_id  UUID REFERENCES posts(id) ON DELETE SET NULL,
  matched_item_id  UUID REFERENCES scraped_items(id) ON DELETE SET NULL,
  -- Which model or writer produced it, and whether that was a live call.
  source           TEXT NOT NULL DEFAULT 'fixture' CHECK (source IN ('live','fixture')),
  model            TEXT,
  fallback_reason  TEXT,
  selected         BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A score with no basis is fabricated evidence. Forbidden at the column level
  -- rather than in a handler, so no future writer can get it wrong quietly.
  CONSTRAINT hook_variants_basis_required
    CHECK (length(btrim(confidence_basis)) > 0),
  -- A score requires the evidence it was derived from. Symmetrically, matching
  -- nothing means scoring nothing.
  CONSTRAINT hook_variants_score_needs_match
    CHECK (confidence IS NULL OR matched_post_id IS NOT NULL OR matched_item_id IS NOT NULL)
);

-- One variant per pattern per generation. A retried generation REPLACES its
-- variant set rather than appending a second one (R4 · idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS hook_variants_idea_pattern_key
  ON hook_variants (idea_id, pattern);
CREATE INDEX IF NOT EXISTS hook_variants_workspace_idx
  ON hook_variants (workspace_id, created_at DESC);
-- At most one selected variant per idea. Enforced here rather than in the
-- handler, because "the chosen hook" must be singular by construction.
CREATE UNIQUE INDEX IF NOT EXISTS hook_variants_one_selected_key
  ON hook_variants (idea_id) WHERE selected;

-- ── tracked_accounts · capture specific handles, not only keywords ─────────
-- Distinct from `sources`, which registers a competitor for the saturation
-- reading. This is a CAPTURE LANE: named accounts read on their own schedule,
-- with the same per-lane ceiling and the same honest empty result.
--
-- Deactivated, never deleted, so a captured item keeps a valid parent.
CREATE TABLE IF NOT EXISTS tracked_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x','facebook')),
  handle       TEXT NOT NULL,
  label        TEXT,
  note         TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  last_captured_at TIMESTAMPTZ,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tracked_accounts_workspace_handle_key
  ON tracked_accounts (workspace_id, platform, lower(handle));
CREATE INDEX IF NOT EXISTS tracked_accounts_workspace_active_idx
  ON tracked_accounts (workspace_id, active);

-- ═══════════════════════════════════════════════════════════════════════════
-- FORWARD-COMPATIBILITY GUARDS · SHORT-FORM
--
-- Same reason as the block further up: `CREATE TABLE IF NOT EXISTS` leaves an
-- existing table exactly as it was, so a column added to a CREATE body never
-- reaches a database that already exists. Without these, `findSchemaDrift()`
-- would report every new column and demand a destructive rebuild.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS views                 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS views_available       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS hook                  TEXT;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS signal_flags          TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS engagement_rate       NUMERIC;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS media_format          TEXT;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS transcript            TEXT;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS transcript_source     TEXT;
ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS transcript_confidence NUMERIC;

-- ── Discovered keywords (ADR-012) ─────────────────────────────────────────
-- Additive, so an existing keyword set keeps every row and every one of them
-- correctly reads as 'seeded' — which is what they are.
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS origin           TEXT NOT NULL DEFAULT 'seeded';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS discovered_at    TIMESTAMPTZ;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS discovery_reason TEXT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS discovery_run_id UUID;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS emergence_score  SMALLINT;
ALTER TABLE keywords DROP CONSTRAINT IF EXISTS keywords_origin_check;
ALTER TABLE keywords ADD  CONSTRAINT keywords_origin_check CHECK (origin IN ('seeded','discovered'));
-- A discovered keyword awaiting a decision is the common lookup.
CREATE INDEX IF NOT EXISTS keywords_workspace_origin_idx
  ON keywords (workspace_id, origin, active);

ALTER TABLE content_ideas ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'post';
ALTER TABLE drafts        ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'post';

-- Re-created by name so an existing table actually gains the constraint.
ALTER TABLE content_ideas DROP CONSTRAINT IF EXISTS content_ideas_content_format_check;
ALTER TABLE content_ideas ADD  CONSTRAINT content_ideas_content_format_check
  CHECK (content_format IN ('post','short_form_script'));
ALTER TABLE drafts        DROP CONSTRAINT IF EXISTS drafts_content_format_check;
ALTER TABLE drafts        ADD  CONSTRAINT drafts_content_format_check
  CHECK (content_format IN ('post','short_form_script'));

-- Finding untranscribed video must not scan the whole corpus.
CREATE INDEX IF NOT EXISTS scraped_items_untranscribed_idx
  ON scraped_items (workspace_id) WHERE transcript IS NULL;
-- The views filter and the high-signal flag both read this.
CREATE INDEX IF NOT EXISTS scraped_items_views_idx
  ON scraped_items (workspace_id, views DESC) WHERE views_available;
