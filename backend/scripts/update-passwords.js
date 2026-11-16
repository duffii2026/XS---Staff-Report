// Update passwords for specific users and require change on first login.
// Run from backend/: node scripts/update-passwords.js
// Override target DB with ENV_FILE, e.g.: cross-env ENV_FILE=.env node scripts/update-passwords.js
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { encryptPassword } from '../services/passwordCrypto.js';

const USERS = [
  ['100', 'ikhzJ4Ir'],
  ['101', 'XjQXqFJk'],
  ['201', 'dMEBJkQA'],
  ['202', 'MKWcec25'],
  ['300', '0PAT80MY'],
  ['301', '7xKp2QmA'],
  ['302', 'N8vL3rTx'],
  ['303', 'cR5mZ1Wp'],
  ['400', 'R8mK2pYv'],
  ['401', 'cT5xN9Qa'],
  ['500', 'yK3mR7Qa'],
  ['501', 'V8tN2pXc'],
  ['503', 'P4xK7nTb'],
  ['600', 'mR8vC3Yq'],
  ['700', 'B6rX2pKa'],
  ['800', 'Q5pL8rTc'],
];

async function main() {
  console.log(`Updating passwords in ${env.DB_NAME} @ ${env.DB_HOST}:${env.DB_PORT} ...`);

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
    timezone: 'Z'
  });

  let updated = 0;
  let notFound = 0;
  let failed = 0;

  for (const [id, plainPw] of USERS) {
    // Try to find the user by username first, then by code (user_<id>).
    let user = await conn.query('SELECT code, username FROM users WHERE username = ? AND is_active = 1', [id]);
    if (!user[0].length) {
      user = await conn.query('SELECT code, username FROM users WHERE code = ? AND is_active = 1', [`user_${id}`]);
    }
    if (!user[0].length) {
      notFound++;
      console.error(`  !! not found: id=${id}`);
      continue;
    }
    const { code, username } = user[0][0];

    try {
      const enc = encryptPassword(plainPw);
      await conn.execute('UPDATE users SET password_hash = ? WHERE code = ?', [enc, code]);
      await conn.execute(
        `INSERT INTO user_password_requirements (user_code, must_change_password, reason)
         VALUES (?, 1, 'first_login')
         ON DUPLICATE KEY UPDATE must_change_password = 1, reason = 'first_login'`,
        [code]
      );
      updated++;
      console.log(`  OK: ${username} (${code})`);
    } catch (err) {
      failed++;
      console.error(`  !! ${code}: ${err.message}`);
    }
  }

  await conn.end();

  console.log('------------------------------------------------');
  console.log(`updated   : ${updated}`);
  console.log(`not found : ${notFound}`);
  console.log(`failed    : ${failed}`);
  console.log('All updated users are flagged to change password on first login.');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[update-passwords] fatal:', err.message);
  process.exitCode = 1;
});
