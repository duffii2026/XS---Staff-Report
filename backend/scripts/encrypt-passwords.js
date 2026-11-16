// One-time migration: encrypt existing plaintext passwords with AES-256-GCM.
// Run once per database:  npm run migrate:passwords  (from backend/)
// The script uses the configured App2 database; review env.js before running.
//
// - Idempotent: rows already stored as "enc:v1:..." are skipped, so it is safe
//   to re-run after a failure.
// - Backs up the current users.password_hash column into a timestamped table
//   before touching anything (drop it once you've verified logins work).
// - Never prints password values — only counts.
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { encryptPassword, isEncrypted } from '../services/passwordCrypto.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  console.log(`Encrypting passwords in ${env.DB_NAME} @ ${env.DB_HOST} ...`);

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
    timezone: 'Z'
  });

  // 1) Backup the existing password column so the change is reversible.
  const backupTable = `users_password_backup_${stamp()}`;
  await conn.query(`CREATE TABLE \`${backupTable}\` AS SELECT code, password_hash FROM users`);
  const [[{ cnt: backedUp }]] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${backupTable}\``);
  console.log(`Backup created: ${backupTable} (${backedUp} rows)`);

  // 2) Encrypt plaintext rows in place (skip null/empty and already-encrypted).
  const [rows] = await conn.execute('SELECT code, password_hash FROM users');
  let encrypted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.password_hash || isEncrypted(row.password_hash)) {
      skipped++;
      continue;
    }
    try {
      const enc = encryptPassword(row.password_hash);
      const [result] = await conn.execute(
        'UPDATE users SET password_hash = ? WHERE code = ? AND password_hash = ?',
        [enc, row.code, row.password_hash]
      );
      if (result.affectedRows === 1) encrypted++;
      else skipped++; // row changed underneath us; leave it for a re-run
    } catch (err) {
      failed++;
      console.error(`  !! ${row.code}: ${err.message}`);
    }
  }

  await conn.end();

  console.log('------------------------------------------------');
  console.log(`encrypted : ${encrypted}`);
  console.log(`skipped   : ${skipped}  (empty / already encrypted)`);
  console.log(`failed    : ${failed}`);
  console.log(`backup    : ${backupTable}`);
  console.log('------------------------------------------------');
  if (failed) {
    console.error('Some rows failed — fix the cause and re-run; the script is idempotent.');
    process.exitCode = 1;
  } else {
    console.log('Done. Verify a login, then drop the backup table when satisfied.');
  }
}

main().catch((err) => {
  console.error('[migrate:passwords] fatal:', err.message);
  process.exitCode = 1;
});
