-- ============================================================
-- Migration v6: Telegram Webhook + AI Task Parsing Support
-- ============================================================

-- Add webhook_secret and update_offset to telegram_config
ALTER TABLE telegram_config 
ADD COLUMN webhook_secret VARCHAR(128) NULL AFTER user_map,
ADD COLUMN update_offset BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER webhook_secret;

-- Add source tracking to trs_tasks
ALTER TABLE trs_tasks 
ADD COLUMN source ENUM('manual','telegram_chat','api') NOT NULL DEFAULT 'manual' AFTER status,
ADD COLUMN source_message_id VARCHAR(64) NULL AFTER source,
ADD COLUMN source_chat_id VARCHAR(64) NULL AFTER source_message_id;

-- Verify changes
SELECT 'telegram_config columns:' as info;
SHOW COLUMNS FROM telegram_config;

SELECT 'trs_tasks new columns:' as info;
SHOW COLUMNS FROM trs_tasks WHERE Field IN ('source', 'source_message_id', 'source_chat_id');