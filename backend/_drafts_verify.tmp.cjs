const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({ host: '3.106.132.155', port: 3306, user: 'abadbrp', password: 'Km2J&ndU$234!2', database: 'apastaffreport', connectTimeout: 15000 });
  const [sw] = await db.query("SELECT COUNT(*) c FROM tr_drafts WHERE week_number > 53 AND year <= 53");
  console.log('STILL SWAPPED:', JSON.stringify(sw));
  const [left] = await db.query("SELECT id, user_code, year, week_number FROM tr_drafts ORDER BY user_code, year, week_number");
  console.log('FINAL:', JSON.stringify(left));
  await db.end();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });