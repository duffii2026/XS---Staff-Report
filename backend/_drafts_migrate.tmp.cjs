const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '3.106.132.155',
    port: 3306,
    user: 'abadbrp',
    password: 'Km2J&ndU$234!2',
    database: 'apastaffreport'
  });
  await db.beginTransaction();
  try {
    const [swapped] = await db.query(
      "SELECT id, user_code, year, week_number FROM tr_drafts WHERE week_number > 53 AND year <= 53"
    );
    console.log('SWAPPED ROWS FOUND:', swapped.length);
    let updated = 0, deleted = 0;
    for (const row of swapped) {
      const cy = row.week_number, cw = row.year;
      const [dup] = await db.query(
        "SELECT id FROM tr_drafts WHERE user_code = ? AND year = ? AND week_number = ? AND id <> ? LIMIT 1",
        [row.user_code, cy, cw, row.id]
      );
      if (dup.length) {
        await db.query("DELETE FROM tr_drafts WHERE id = ?", [row.id]);
        console.log(`DELETE dup id=${row.id} (${row.user_code} y${cy}/w${cw})`);
        deleted++;
      } else {
        await db.query("UPDATE tr_drafts SET year = ?, week_number = ? WHERE id = ?", [cy, cw, row.id]);
        console.log(`FIXED id=${row.id}: ${row.year}/${row.week_number} -> ${cy}/${cw}`);
        updated++;
      }
    }
    await db.commit();
    console.log('DONE. updated=', updated, 'deleted=', deleted);
  } catch (e) {
    await db.rollback();
    throw e;
  }
  const [left] = await db.query("SELECT id, user_code, year, week_number FROM tr_drafts ORDER BY user_code, year, week_number");
  console.log('FINAL TR_DRAFTS:', JSON.stringify(left, null, 2));
  await db.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });