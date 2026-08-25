// ─── AppError Class ───────────────────────────────────────────────────────────
// ✅ PRODUCTION FIX: Enhanced AppError with error codes
class AppError extends Error {
  constructor(message, statusCode, errorCode = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode; // Machine-readable error code
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Async Handler Wrapper ────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ─── Pagination Helper ────────────────────────────────────────────────────────
const getPaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── Filter Object ────────────────────────────────────────────────────────────
const filterObj = (obj, ...allowedFields) => {
  const filtered = {};
  allowedFields.forEach((field) => { if (obj[field] !== undefined) filtered[field] = obj[field]; });
  return filtered;
};

// ─── Format Currency ──────────────────────────────────────────────────────────
const formatCurrency = (amount) => `₹${amount.toFixed(2)}`;

// ─── Random String ────────────────────────────────────────────────────────────
const randomString = (length = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

module.exports = { AppError, asyncHandler, getPaginationParams, filterObj, formatCurrency, randomString };
