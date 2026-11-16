-- ============================================================
-- APA Staff Report — v4 Feature Migration (new tables)
-- 1-Click Telegram connect via deep-link handshake.
-- NOTE: no USE statement here — migrate.js already selects the
-- configured APA 2 database.
-- Applied idempotently by scripts/migrate.js
-- ============================================================

-- ------------------------------------------------------------
-- telegram_link_tokens
-- One row per pending "connect my Telegram" handshake. A random
-- deep-link code (t.me/<bot>?start=<code>) is issued to the user;
-- when the bot receives "/start <code>" we bind the sender's
-- chat_id + username to the requesting user and mark it consumed.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  chat_id VARCHAR(64) NULL,
  username VARCHAR(64) NULL,
  consumed_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  KEY idx_tg_link_user (user_code),
  KEY idx_tg_link_expiry (expires_at)
) ENGINE=InnoDB;
