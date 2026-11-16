const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '3.106.132.155',
    port: 3306,
    user: 'abadbrp',
    password: 'Km2J&ndU$234!2',
    database: 'apastaffreport'
  });
  const [cols] = await db.query("SHOW COLUMNS FROM tr_drafts");
  console.log('TR_DRAFTS COLS:', cols.map(c => c.Field + ':' + c.Type).join(', '));
  const [rows] = await db.query("SELECT * FROM tr_drafts");
  console.log('ALL TR_DRAFTS:', JSON.stringify(rows, null, 2));
  await db.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });