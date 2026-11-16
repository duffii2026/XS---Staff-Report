-- ============================================================
-- Migration v8: Saved AI team report summaries
-- Each generated summary is stored as its own immutable row so the
-- superior can revisit it as chat-style history. No columns are added
-- to `reports`; selected report codes + display snapshots live here.
-- NOTE: no USE statement — migrate.js selects the active database.
-- Applied idempotently by scripts/migrate.js
-- ============================================================

CREATE TABLE IF NOT EXISTS tr_team_summaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  generated_by VARCHAR(64) NOT NULL,
  generated_by_name VARCHAR(128) NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  report_codes JSON NOT NULL,
  report_snapshot JSON NOT NULL,
  report_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  summary_text MEDIUMTEXT NOT NULL,
  model VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_summary_code (code),
  KEY idx_team_summary_owner (generated_by, created_at)
) ENGINE=InnoDB;
