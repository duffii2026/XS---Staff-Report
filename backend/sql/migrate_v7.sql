-- ============================================================
-- Migration v7: Weekly Summary Form (IRG-HR-FRM-WSUM-001 v1.1)
-- Sections A-J of the weekly submission, stored in its OWN table
-- keyed by report code — deliberately NOT extra columns on `reports`.
-- NOTE: no USE statement here — migrate.js already selects the
-- configured APA 2 database.
-- Applied idempotently by scripts/migrate.js
-- ============================================================

CREATE TABLE IF NOT EXISTS tr_weekly_summaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_code VARCHAR(64) NOT NULL,
  staff_code VARCHAR(64) NOT NULL,
  year SMALLINT NOT NULL,
  week_number TINYINT NOT NULL,
  summary_data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_summary_report (report_code),
  KEY idx_summary_staff_week (staff_code, year, week_number)
) ENGINE=InnoDB;
