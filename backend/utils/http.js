export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data = null, status = 200) =>
  res.status(status).json({ success: true, status, data });

export const fail = (res, status, message, details = null) =>
  res.status(status).json({ success: false, status, message, details });