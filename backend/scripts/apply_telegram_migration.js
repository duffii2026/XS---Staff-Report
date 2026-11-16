require('dotenv').config({ path: '.env' });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('Connected to', process.env.DB_HOST, process.env.DB_NAME);

  // Add webhook_secret
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM telegram_config LIKE 'webhook_secret'");
    if (cols.length === 0) {
      await conn.query("ALTER TABLE telegram_config ADD COLUMN webhook_secret VARCHAR(128) NULL AFTER user_map");
      console.log('Added webhook_secret');
    } else {
      console.log('webhook_secret exists');
    }
  } catch (e) {
    console.log('ERR webhook_secret:', e.message);
  }

  // Ensure update_offset exists as BIGINT UNSIGNED NOT NULL DEFAULT 0
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM telegram_config LIKE 'update_offset'");
    if (cols.length === 0) {
      await conn.query("ALTER TABLE telegram_config ADD COLUMN update_offset BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER webhook_secret");
      console.log('Added update_offset');
    } else {
      console.log('update_offset exists:', cols[0].Type, cols[0].Null, cols[0].Default);
    }
  } catch (e) {
    console.log('ERR update_offset:', e.message);
  }

  // Add source to trs_tasks
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM trs_tasks LIKE 'source'");
    if (cols.length === 0) {
      await conn.query("ALTER TABLE trs_tasks ADD COLUMN source ENUM('manual','telegram_chat','api') NOT NULL DEFAULT 'manual' AFTER status");
      console.log('Added source');
    } else {
      console.log('source exists');
    }
  } catch (e) {
    console.log('ERR source:', e.message);
  }

  // Add source_message_id
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM trs_tasks LIKE 'source_message_id'");
    if (cols.length === 0) {
      await conn.query("ALTER TABLE trs_tasks ADD COLUMN source_message_id VARCHAR(64) NULL AFTER source");
      console.log('Added source_message_id');
    } else {
      console.log('source_message_id exists');
    }
  } catch (e) {
    console.log('ERR source_message_id:', e.message);
  }

  // Add source_chat_id
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM trs_tasks LIKE 'source_chat_id'");
    if (cols.length === 0) {
      await conn.query("ALTER TABLE trs_tasks ADD COLUMN source_chat_id VARCHAR(64) NULL AFTER source_message_id");
      console.log('Added source_chat_id');
    } else {
      console.log('source_chat_id exists');
    }
  } catch (e) {
    console.log('ERR source_chat_id:', e.message);
  }

  // Verify counts
  const [users] = await conn.query('SELECT COUNT(*) as c FROM users');
  const [trs] = await conn.query('SELECT COUNT(*) as c FROM trs_tasks');
  const [reports] = await conn.query('SELECT COUNT(*) as c FROM reports');
  console.log('Counts - users:', users[0].c, 'trs_tasks:', trs[0].c, 'reports:', reports[0].c);

  await conn.end();
  console.log('Migration complete. No existing data modified.');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
