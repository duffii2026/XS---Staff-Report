import { Router } from 'express';
import { asyncHandler, ok } from '../utils/http.js';
import authRoutes from './auth.js';
import userRoutes from './users.js';
import templateRoutes from './templates.js';
import reportRoutes from './reports.js';
import trsRoutes from './trs.js';
import appraisalRoutes from './appraisals.js';
import notificationRoutes from './notifications.js';
import noticeRoutes from './notices.js';
import telegramRoutes from './telegram.js';
import signatureRoutes from './signatures.js';
import auditRoutes from './audit.js';
import apiKeyRoutes from './apiKeys.js';
import dashboardRoutes from './dashboard.js';
import aiRoutes from './ai.js';
import orgConfigRoutes from './orgConfig.js';
import { uploadsRouter as fileUploadRoutes } from './files.js';

const router = Router();

// Health (public)
router.get('/health', asyncHandler(async (req, res) => {
  ok(res, {
    status: 'ok',
    time: new Date().toISOString(),
    service: 'apa-staff-report-backend',
    version: '1.0.0'
  });
}));

// Public + session/auth (auth router handles its own public/private split)
router.use('/auth', authRoutes);

// Everything below requires authentication
router.use('/users', userRoutes);
router.use('/templates', templateRoutes);
router.use('/reports', reportRoutes);
router.use('/trs', trsRoutes);
router.use('/appraisals', appraisalRoutes);
router.use('/notifications', notificationRoutes);
router.use('/notices', noticeRoutes);
router.use('/telegram', telegramRoutes);
router.use('/signatures', signatureRoutes);
router.use('/audit', auditRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/ai', aiRoutes);
router.use('/org-config', orgConfigRoutes);
router.use('/files', fileUploadRoutes);

export default router;
