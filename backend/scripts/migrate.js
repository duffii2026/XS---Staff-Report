// Idempotent migration for v2 features (notice board, onboarding, score
// disputes, TRS comments, TR drafts, multi-proof / escalation fields).
// Run: node scripts/migrate.js  (from backend/)
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Migrating apastaffreport (v2 features) ...');

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: true,
    timezone: 'Z'
  });

  await conn.query('USE ??', [env.DB_NAME]);

  // ---------------------------------------------------------------
  // 1) New tables
  // ---------------------------------------------------------------
  const schemaPath = path.resolve(__dirname, '../sql/migrate_v2.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await conn.query(schema);
  console.log('New tables ensured.');

  // v3 tables (no USE statement — re-select the target DB first so the app2
  // instance isn't affected by migrate_v2.sql's hardcoded USE)
  await conn.query('USE ??', [env.DB_NAME]);
  const schemaV3Path = path.resolve(__dirname, '../sql/migrate_v3.sql');
  const schemaV3 = fs.readFileSync(schemaV3Path, 'utf8');
  await conn.query(schemaV3);
  console.log('v3 tables ensured.');

  // v4 tables (1-click Telegram deep-link handshake)
  const schemaV4Path = path.resolve(__dirname, '../sql/migrate_v4.sql');
  const schemaV4 = fs.readFileSync(schemaV4Path, 'utf8');
  await conn.query(schemaV4);
  console.log('v4 tables ensured.');

  // v5 tables (org config master lists: departments & positions)
  const schemaV5Path = path.resolve(__dirname, '../sql/migrate_v5.sql');
  const schemaV5 = fs.readFileSync(schemaV5Path, 'utf8');
  await conn.query(schemaV5);
  // Normalize collations for pre-existing tables. CREATE TABLE IF NOT EXISTS is a
  // no-op when org_config already exists, so an earlier install would keep MySQL 8's
  // default utf8mb4_0900_ai_ci and every list query would fail with
  // "Illegal mix of collations" when joining name against users.department/position
  // (those are utf8mb4_unicode_ci). MODIFY is idempotent, so this is safe to re-run.
  await conn.query(
    `ALTER TABLE org_config
       MODIFY kind ENUM('department','position') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
       MODIFY name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`
  );
  console.log('v5 tables ensured.');

  // ---------------------------------------------------------------
  // 2) New columns (information_schema guard for idempotency)
  // ---------------------------------------------------------------
  async function ensureColumn(table, col, definition) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, col]
    );
    if (Number(rows[0].c) > 0) return;
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${definition}`);
    console.log(`  + ${table}.${col}`);
  }

  const reportCols = [
    ['multi_proof', 'JSON NULL'],
    ['dispute', 'JSON NULL'],
    ['delay_reason', 'TEXT NULL'],
    ['late_penalty_waived', 'TINYINT(1) NULL'],
    ['waived_by', 'VARCHAR(64) NULL'],
    ['waived_by_name', 'VARCHAR(128) NULL'],
    ['escalated_to', 'VARCHAR(64) NULL'],
    ['escalated_to_name', 'VARCHAR(128) NULL'],
    ['escalation_level', "ENUM('none','reminded','escalated') NULL"],
    ['escalated_at', 'DATETIME NULL'],
    ['approved_deadline', 'DATETIME NULL'],
    ['extension_request', 'JSON NULL'],
    ['extension_history', 'JSON NULL']
  ];
  for (const [col, def] of reportCols) await ensureColumn('reports', col, def);

  const trsCols = [
    ['multi_proof', 'JSON NULL'],
    ['dispute', 'JSON NULL'],
    ['revision_history', 'JSON NULL'],
    ['is_escalated', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['escalated_to', 'VARCHAR(64) NULL'],
    ['escalated_to_name', 'VARCHAR(128) NULL'],
    ['escalation_level', "ENUM('none','reminded','escalated') NULL"],
    ['escalated_reason', 'TEXT NULL'],
    ['escalated_at', 'DATETIME NULL']
  ];
  for (const [col, def] of trsCols) await ensureColumn('trs_tasks', col, def);

  // TRS Task auto-lock columns (v4: 7-day non-submission default at 0% + admin unlock audit trail)
  const trsAutoLockCols = [
    ['is_defaulted', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['defaulted_at', 'DATETIME NULL'],
    ['unlock_history', 'JSON NULL'],
    ['unlock_by', 'VARCHAR(64) NULL']
  ];
  for (const [col, def] of trsAutoLockCols) await ensureColumn('trs_tasks', col, def);

  // Extend trs_tasks.status ENUM to include 'Defaulted' (idempotent)
  {
    const [statusCol] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trs_tasks' AND COLUMN_NAME = 'status'`
    );
    const type = statusCol[0]?.COLUMN_TYPE || '';
    if (!type.includes('Defaulted')) {
      await conn.query(`ALTER TABLE trs_tasks
        MODIFY COLUMN status ENUM('Pending','In Progress','Completed','Overdue','Defaulted') NOT NULL DEFAULT 'Pending'`);
      console.log('  + trs_tasks.status ENUM extended with Defaulted');
    }
  }

  await ensureColumn('users', 'onboarding', 'JSON NULL');

  // Telegram getUpdates cursor for the 1-click connect handshake
  await ensureColumn('telegram_config', 'update_offset', 'BIGINT NULL');

  // ---------------------------------------------------------------
  // 3) Seed demo notices if the table is empty
  // ---------------------------------------------------------------
  const [existing] = await conn.query('SELECT COUNT(*) AS c FROM notices');
  if (Number(existing[0].c) === 0) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const notices = [
      {
        code: 'notice_welcome',
        title: 'Welcome to the APA Staff Report Platform',
        content:
          'This unified portal centralizes weekly T&R reporting, TRS task delegation, performance evaluation, and governance notices. Complete the Quick-Start onboarding checklist to get fully set up.',
        priority: 'standard',
        category: 'System',
        authorId: 'system',
        authorName: 'APA Governance',
        authorRole: 'admin',
        departmentScope: 'all',
        isPinned: 1,
        createdAt: now
      },
      {
        code: 'notice_deadline',
        title: 'Deadline Enforcement for Weekly T&R Reports',
        content:
          'Weekly T&R reports must be submitted before the Saturday 20:00 cutoff. Late submissions require a delay reason and are subject to supervisor waiver or point deduction.',
        priority: 'important',
        category: 'Deadline',
        authorId: 'system',
        authorName: 'APA Governance',
        authorRole: 'admin',
        departmentScope: 'all',
        isPinned: 1,
        createdAt: now
      }
    ];
    for (const n of notices) {
      await conn.execute(
        `INSERT INTO notices (code, title, content, priority, category, author_id, author_name, author_role, department_scope, is_pinned, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [n.code, n.title, n.content, n.priority, n.category, n.authorId, n.authorName, n.authorRole, n.departmentScope, n.isPinned, n.createdAt]
      );
    }
    console.log(`Seeded ${notices.length} demo notices.`);
  }

  await conn.end();
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});