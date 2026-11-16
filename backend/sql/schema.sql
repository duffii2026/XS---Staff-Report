-- ============================================================
-- APA Staff Report — Database Schema
-- Target: MySQL 8.x  (port 3308 local)
-- Business-ID convention: each table has numeric PK `id` +
-- human `code` (e.g. user_shawn, trs_xxx) to stay compatible
-- with the SPA data model.
-- ============================================================

CREATE DATABASE IF NOT EXISTS apastaffreport
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE apastaffreport;

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NULL,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  role ENUM('admin','hr','executive','manager','staff') NOT NULL DEFAULT 'staff',
  department VARCHAR(64) NOT NULL DEFAULT '',
  position VARCHAR(64) NOT NULL DEFAULT '',
  superior_id VARCHAR(64) NULL,
  avatar_url VARCHAR(512) NULL,
  telegram_chat_id VARCHAR(64) NULL,
  telegram_username VARCHAR(64) NULL,
  telegram_connected_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_code (code),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_superior (superior_id),
  KEY idx_users_role (role),
  KEY idx_users_department (department)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- user_permissions (normalized permission matrix, 7 keys)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_permissions (
  user_code VARCHAR(64) NOT NULL,
  permission_key VARCHAR(48) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_code, permission_key),
  KEY idx_perm_key (permission_key)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- role_templates (JD position checklist templates)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  position_title VARCHAR(128) NOT NULL,
  department VARCHAR(64) NOT NULL DEFAULT 'All Departments',
  last_updated DATE NULL,
  items JSON NULL,
  created_by VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_templates_code (code),
  KEY idx_templates_position (position_title, department)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- reports (T&R weekly reports)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  staff_code VARCHAR(64) NOT NULL,
  staff_name VARCHAR(128) NOT NULL,
  department VARCHAR(64) NOT NULL DEFAULT '',
  position VARCHAR(64) NOT NULL DEFAULT '',
  superior_code VARCHAR(64) NULL,
  year SMALLINT NOT NULL,
  quarter TINYINT NOT NULL,
  month TINYINT NOT NULL,
  week_number TINYINT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  submission_date DATETIME NULL,
  checklist_items JSON NULL,
  tr_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  completion_score DECIMAL(5,2) NULL,
  timeliness_score DECIMAL(5,2) NULL,
  quality_score DECIMAL(5,2) NULL,
  signature JSON NULL,
  notes TEXT NULL,
  ai_summary TEXT NULL,
  status ENUM('Draft','Submitted','Reviewed','Approved') NOT NULL DEFAULT 'Draft',
  manager_feedback TEXT NULL,
  review_date DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reports_code (code),
  KEY idx_reports_staff_week (staff_code, year, week_number),
  KEY idx_reports_superior (superior_code),
  KEY idx_reports_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- trs_tasks (superior-delegated tasks)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trs_tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  assigned_by VARCHAR(64) NOT NULL,
  assigned_by_name VARCHAR(128) NOT NULL,
  assigned_to VARCHAR(64) NOT NULL,
  assigned_to_name VARCHAR(128) NOT NULL,
  department VARCHAR(64) NOT NULL DEFAULT '',
  description TEXT NULL,
  assigned_date DATE NOT NULL,
  deadline DATE NOT NULL,
  task_code VARCHAR(32) NULL,
  project VARCHAR(128) NULL,
  priority ENUM('Urgent','High','Medium','Low') NULL,
  progress TINYINT NULL,
  instructions TEXT NULL,
  scope TEXT NULL,
  quality_criteria TEXT NULL,
  status ENUM('Pending','In Progress','Completed','Overdue','Defaulted') NOT NULL DEFAULT 'Pending',
  evaluation_status ENUM('Approved','Reviewed','Revision') NULL,
  evaluation_date DATE NULL,
  evaluated_by VARCHAR(64) NULL,
  completion_date DATE NULL,
  score DECIMAL(5,2) NULL,
  feedback TEXT NULL,
  staff_remarks TEXT NULL,
  submission_notes TEXT NULL,
  delay_reason TEXT NULL,
  timeliness_score DECIMAL(5,2) NULL,
  quality_score DECIMAL(5,2) NULL,
  instruction_score DECIMAL(5,2) NULL,
  scope_score DECIMAL(5,2) NULL,
  accuracy_score DECIMAL(5,2) NULL,
  late_penalty_waived TINYINT(1) NULL,
  revision_count TINYINT NULL,
  proof_url VARCHAR(512) NULL,
  submitted_at DATETIME NULL,
  signature JSON NULL,
  is_defaulted TINYINT(1) NOT NULL DEFAULT 0,
  defaulted_at DATETIME NULL,
  unlock_history JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trs_code (code),
  KEY idx_trs_assigned_to (assigned_to, status),
  KEY idx_trs_assigned_by (assigned_by),
  KEY idx_trs_deadline (deadline)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- appraisals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appraisals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  staff_code VARCHAR(64) NOT NULL,
  staff_name VARCHAR(128) NOT NULL,
  department VARCHAR(64) NOT NULL DEFAULT '',
  position VARCHAR(64) NOT NULL DEFAULT '',
  period_year SMALLINT NULL,
  period_quarter VARCHAR(16) NULL,
  period_month VARCHAR(16) NULL,
  period VARCHAR(64) NULL,
  tr_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  trs_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  overall_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  signature_mode ENUM('physical','digital','hard_copy') NOT NULL DEFAULT 'digital',
  status ENUM('Draft','Pending Executive Approval','Fully Approved') NOT NULL DEFAULT 'Draft',
  prepared_by_user_code VARCHAR(64) NULL,
  prepared_by_name VARCHAR(128) NULL,
  prepared_by_role VARCHAR(128) NULL,
  prepared_signature JSON NULL,
  prepared_date DATETIME NULL,
  prepared_notes TEXT NULL,
  approved_by_user_code VARCHAR(64) NULL,
  approved_by_name VARCHAR(128) NULL,
  approved_by_role VARCHAR(128) NULL,
  approved_signature JSON NULL,
  approved_date DATETIME NULL,
  approved_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_appraisal_code (code),
  KEY idx_appraisal_staff (staff_code, period_year),
  KEY idx_appraisal_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  recipient_user_code VARCHAR(64) NOT NULL,
  sender_code VARCHAR(64) NOT NULL DEFAULT 'system',
  sender_name VARCHAR(128) NOT NULL DEFAULT 'APA System',
  type VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
  title VARCHAR(255) NOT NULL DEFAULT '',
  message TEXT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  link_tab VARCHAR(16) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_code (code),
  KEY idx_notif_recipient (recipient_user_code, is_read)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- activity_logs (audit trail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  user_code VARCHAR(64) NULL,
  username VARCHAR(64) NOT NULL DEFAULT 'system',
  user_role VARCHAR(32) NOT NULL DEFAULT '',
  action VARCHAR(64) NOT NULL,
  details TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_log_code (code),
  KEY idx_log_user (user_code),
  KEY idx_log_action (action)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- telegram_config (single row)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_config (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  bot_token VARCHAR(255) NOT NULL DEFAULT '',
  bot_username VARCHAR(64) NOT NULL DEFAULT '',
  main_group_chat_id VARCHAR(64) NULL,
  channel_name VARCHAR(128) NULL,
  triggers JSON NULL,
  user_map JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- saved_signatures (reusable personal signatures, refs stored in S3)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_signatures (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_code VARCHAR(64) NOT NULL,
  sig_type ENUM('handwritten','digital_type','uploaded') NOT NULL DEFAULT 'handwritten',
  s3_key VARCHAR(512) NOT NULL,
  signee_name VARCHAR(128) NOT NULL,
  signed_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sig_user (user_code),
  KEY idx_sig_user_time (user_code, signed_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- user_password_requirements (forced password change state)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_password_requirements (
  user_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  reason VARCHAR(32) NOT NULL DEFAULT 'first_login',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_code)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- sessions (refresh-token session management)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  user_code VARCHAR(64) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NULL,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_session_token (token_hash),
  KEY idx_session_user (user_code)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- api_keys (server-to-server / bot / daemon)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  key_hash CHAR(64) NOT NULL,
  user_code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL DEFAULT '',
  scopes JSON NULL,
  last_used_at DATETIME NULL,
  expires_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_apikey_hash (key_hash),
  KEY idx_apikey_user (user_code)
) ENGINE=InnoDB;

-- Log/notification capping (e.g. keep last 5000) is enforced in the app layer.