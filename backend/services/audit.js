import { query } from '../config/db.js';
import { nanoid } from 'nanoid';
import { toMySqlDatetime } from './auth.js';

/**
 * Extract real client IP from request, handling various proxy headers.
 * Checks X-Forwarded-For, X-Real-IP, CF-Connecting-IP (Cloudflare), etc.
 */
export function getClientIp(req) {
  // X-Forwarded-For: client, proxy1, proxy2...
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(s => s.trim());
    // Return the first non-internal IP, or the first one
    return ips[0];
  }
  // X-Real-IP (nginx)
  if (req.headers['x-real-ip']) {
    return req.headers['x-real-ip'];
  }
  // Cloudflare
  if (req.headers['cf-connecting-ip']) {
    return req.headers['cf-connecting-ip'];
  }
  // Fastly, etc.
  if (req.headers['fastly-client-ip']) {
    return req.headers['fastly-client-ip'];
  }
  // Fallback to Express req.ip (respects trust proxy)
  return req.ip;
}

export async function logActivity(actor, { action, details, ip, req }) {
  const code = `log_${nanoid(16)}`;
  const clientIp = req ? getClientIp(req) : ip;
  await query(
    `INSERT INTO activity_logs (code, user_code, username, user_role, action, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      actor?.code || null,
      actor?.username || 'system',
      actor?.role || 'system',
      action,
      details != null ? String(details).slice(0, 1000) : null,
      clientIp
    ]
  );
}

export async function notifyUser({
  recipientCode,
  senderCode = 'system',
  senderName = 'APA System',
  type = 'SYSTEM',
  title = '',
  message = '',
  linkTab = null
}) {
  const code = `notif_${nanoid(16)}`;
  await query(
    `INSERT INTO notifications (code, recipient_user_code, sender_code, sender_name, type, title, message, link_tab)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, recipientCode, senderCode, senderName, type, title, message, linkTab]
  );
  return code;
}

export function makeCode(prefix) {
  return `${prefix}_${nanoid(12)}`;
}