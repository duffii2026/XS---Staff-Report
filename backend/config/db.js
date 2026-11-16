import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: true
});

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function insert(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

/**
 * Multi-row insert, e.g. bulkInsert('user_permissions', ['user_code','permission_key','allowed'], rows)
 */
export async function bulkInsert(table, columns, rows) {
  if (!rows || !rows.length) return;
  const placeholders = rows.map((r) => `(${columns.map(() => '?').join(',')})`).join(',');
  const flat = rows.flatMap((r) => columns.map((c) => r[c]));
  return pool.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`,
    flat
  );
}

export function withTransaction(asyncFn) {
  return pool.getConnection().then(async (conn) => {
    try {
      await conn.beginTransaction();
      const result = await asyncFn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
}

export async function pingDatabase() {
  const rows = await query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}