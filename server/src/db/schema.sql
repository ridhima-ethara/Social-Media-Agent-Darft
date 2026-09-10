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
  -- How well the body aligned with the brand topics and the Knowledge Base,
  -- scored at capture. Anything below the run's floor never became a row.
  brand_relevance  SMALLINT NOT NULL DEFAULT 0,
  posted_at        TIMESTAMPTZ,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at     TIMESTAMPTZ
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
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
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
