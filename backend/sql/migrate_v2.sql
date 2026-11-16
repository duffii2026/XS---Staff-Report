-- ============================================================
-- APA Staff Report — v2 Feature Migration (new tables)
-- Applied idempotently by scripts/migrate.js
-- ============================================================

-- ------------------------------------------------------------
-- notices (Announcement & Notice Board)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  priority ENUM('urgent','important','standard') NOT NULL DEFAULT 'standard',
  category ENUM('General','Policy','Deadline','System') NOT NULL DEFAULT 'General',
  author_id VARCHAR(64) NOT NULL DEFAULT 'system',
  author_name VARCHAR(128) NOT NULL DEFAULT 'APA Governance',
  author_role VARCHAR(32) NOT NULL DEFAULT 'admin',
  department_scope VARCHAR(64) NOT NULL DEFAULT 'all',
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notice_code (code),
  KEY idx_notices_priority (priority),
  KEY idx_notices_category (category)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- notice_read_receipts (per-user acknowledgment of notices)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notice_read_receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notice_code VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  user_role VARCHAR(32) NOT NULL DEFAULT '',
  department VARCHAR(64) NOT NULL DEFAULT '',
  read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notice_user (notice_code, user_id),
  KEY idx_notice_receipts (notice_code)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- trs_task_comments (threaded discussion on TRS tasks)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trs_task_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  task_code VARCHAR(64) NOT NULL,
  author_id VARCHAR(64) NOT NULL,
  author_name VARCHAR(128) NOT NULL,
  author_role VARCHAR(32) NOT NULL DEFAULT '',
  author_avatar_url VARCHAR(512) NULL,
  message TEXT NOT NULL,
  reply_to_code VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_comment_code (code),
  KEY idx_comments_task (task_code),
  KEY idx_comments_reply (reply_to_code)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- tr_drafts (TR autosave drafts keyed by user + week)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tr_drafts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_code VARCHAR(64) NOT NULL,
  year SMALLINT NOT NULL,
  week_number TINYINT NOT NULL,
  draft_data JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_draft_user_week (user_code, year, week_number),
  KEY idx_drafts_user (user_code)
) ENGINE=InnoDB;
