-- ============================================================
-- APA Staff Report — v3 Feature Migration (new tables)
-- Forced password change on first login.
-- NOTE: no USE statement here — migrate.js already selects the
-- configured APA 2 database.
-- Applied idempotently by scripts/migrate.js
-- ============================================================

-- ------------------------------------------------------------
-- user_password_requirements (force "change password" state)
-- A row exists only while a user must change their password
-- (e.g. newly created account or after an admin reset). The
-- row is deleted once the user sets a new password.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_password_requirements (
  user_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  reason VARCHAR(32) NOT NULL DEFAULT 'first_login',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_code)
) ENGINE=InnoDB;
