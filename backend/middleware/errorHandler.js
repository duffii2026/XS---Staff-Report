import { ApiError, asyncHandler } from '../utils/http.js';

export function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  if (status === 500) console.error('[API ERROR]', err);
  res.status(status).json({
    success: false,
    status,
    message,
    ...(process.env.NODE_ENV !== 'production' && status === 500 ? { detail: String(err?.message || err) } : {})
  });
}

export { ApiError, asyncHandler };