import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { pingDatabase } from './config/db.js';
import routes from './routes/index.js';
import filesRouter from './routes/files.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { startDeadlineDaemon } from './services/deadline.js';

const app = express();

  app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Public auth endpoints are already thin; harden globally anyway
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, status: 429, message: 'Too many requests, slow down.' }
}));

app.use('/api', routes);

// Public S3 file streaming (reportupload/signature_xxx.png)
app.use(filesRouter);

// 404 + error handling must come AFTER routes
app.use(notFoundHandler);
app.use(errorHandler);

let daemon = null;
app.listen(env.PORT, async () => {
  try {
    const okDb = await pingDatabase();
    console.log(`[apa-staff-report] API listening on http://localhost:${env.PORT} (db: ${okDb ? 'connected → ' + env.DB_NAME  + " " + env.DB_HOST : 'FAILED'})`);
    if (okDb) {
      daemon = startDeadlineDaemon(env.DEADLINE_DAEMON_INTERVAL_MS);
      console.log('[deadline-daemon] started');
    }
  } catch (err) {
    console.error('[startup]', err.message);
  }
});

export { app, daemon };