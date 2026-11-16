import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The single local application profile uses the App2 database configuration.
const envFileOverride = process.env.ENV_FILE;
let envFileToLoad;

if (envFileOverride) {
  // Explicit env file (absolute or relative to cwd)
  envFileToLoad = path.isAbsolute(envFileOverride)
    ? envFileOverride
    : path.resolve(process.cwd(), envFileOverride);
} else {
  const envPath = path.resolve(process.cwd(), '.env');
  const sourceEnvPath = path.resolve(__dirname, '../.env');
  envFileToLoad = fs.existsSync(envPath) ? envPath : sourceEnvPath;
}

dotenv.config({ path: envFileToLoad });

// Optional AWS credentials file/profile. If unset, use the default credential chain.
// A path that does not exist on this machine (e.g. a Windows path copied to a Linux
// server) is ignored instead of crashing: we drop the override and fall back to the
// default chain (~/.aws/credentials → env vars → IAM role).
const awsSharedCredentialsFile = process.env.AWS_SHARED_CREDENTIALS_FILE || '';
if (awsSharedCredentialsFile && !fs.existsSync(awsSharedCredentialsFile)) {
  console.warn(
    `[env] AWS_SHARED_CREDENTIALS_FILE not found on this machine (${awsSharedCredentialsFile}) ` +
    '— ignoring it and using the default AWS credential chain.'
  );
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;
  // The profile belongs to the same override; without its file it would only
  // shadow the default profile, so drop it too.
  delete process.env.AWS_PROFILE;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5812,
  APP_URL: process.env.APP_URL || `http://localhost:5812`,
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL || 'http://localhost:3000', // origin that serves /reportupload/*
  SITE_URL: process.env.SITE_URL || process.env.APP_URL || `http://localhost:5812`, // dynamic website url for Telegram buttons

  // Database
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: parseInt(process.env.DB_PORT, 10) || 3300,
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '123$$',
  DB_NAME: process.env.DB_NAME || 'APA 2 - Staff Report',

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || 'apa-staff-report-dev-secret-change-me',
  // Reversible password encryption key (AES-256-GCM). 32 random bytes, base64.
  // No default: passwordCrypto fails fast if this is missing/invalid.
  PASSWORD_ENCRYPTION_KEY: process.env.PASSWORD_ENCRYPTION_KEY || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h', // access token
  // Sliding idle window: activity extends this on every authenticated request.
  SESSION_TTL_MS: parseInt(process.env.SESSION_TTL_MS, 10) || 24 * 60 * 60 * 1000, // idle session 24h
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'lax',

  // CORS / proxy origin (comma-separated allowed origins)
  CORS_ORIGIN: (process.env.CORS_ORIGIN || 'http://localhost:3555').split(',').map((o) => o.trim()),

  // AWS S3
  AWS_REGION: process.env.AWS_REGION || 'ap-southeast-1',
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || 'image-apa-app2',
  AWS_S3_PREFIX: process.env.AWS_S3_PREFIX || 'reportupload',
  AWS_S3_SIGN_EXPIRY_S: parseInt(process.env.AWS_S3_SIGN_EXPIRY_S, 10) || 900, // 15 min presigned GET
  // '' → default credential provider chain; a set path is validated above (missing → '')
  AWS_SHARED_CREDENTIALS_FILE: process.env.AWS_SHARED_CREDENTIALS_FILE || '',
  AWS_PROFILE: process.env.AWS_PROFILE || '',

  // Gemini AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.6-flash'
};
