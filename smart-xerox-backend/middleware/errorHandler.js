const logger = require('../config/logger');

// ✅ PRODUCTION FIX: Structured error codes for client-side handling
const ERROR_CODES = {
  // Authentication errors
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  
  // Payment errors
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  REFUND_FAILED: 'REFUND_FAILED',
  
  // Printer errors
  PRINTER_OFFLINE: 'PRINTER_OFFLINE',
  PRINTER_ERROR: 'PRINTER_ERROR',
  NO_PRINTER_AVAILABLE: 'NO_PRINTER_AVAILABLE',
  IPP_TIMEOUT: 'IPP_TIMEOUT',
  
  // Order errors
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_EXPIRED: 'ORDER_EXPIRED',
  INVALID_OTP: 'INVALID_OTP',
  ORDER_ALREADY_PICKED: 'ORDER_ALREADY_PICKED',
  
  // Shop errors
  SHOP_CLOSED: 'SHOP_CLOSED',
  SHOP_NOT_FOUND: 'SHOP_NOT_FOUND',
  
  // File errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_SUPPORTED: 'FILE_TYPE_NOT_SUPPORTED',
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // System errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
};

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;
  error.errorCode = err.errorCode || null; // Custom error code

  // Log error — never log req.body (may contain passwords/tokens)
  if (error.statusCode >= 500) {
    logger.error(`${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.method}`, {
      stack: err.stack,
      errorCode: error.errorCode,
    });
  } else {
    logger.warn(`${error.statusCode} - ${error.message} - ${req.originalUrl} - ${error.errorCode || 'NO_CODE'}`);
  }

  // ✅ PRODUCTION FIX: Enhanced error mapping with error codes
  
  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    error.message = `Invalid ${err.path}: ${err.value}`;
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.INVALID_INPUT;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = `${field.charAt(0).toUpperCase() + field.slice(1)} already in use`;
    error.statusCode = 409;
    error.errorCode = ERROR_CODES.DUPLICATE_ENTRY;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    error.message = messages.join('. ');
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.VALIDATION_ERROR;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token. Please log in again.';
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.INVALID_TOKEN;
  }
  if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired. Please log in again.';
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.TOKEN_EXPIRED;
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error.message = 'File too large. Maximum size is 50MB.';
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.FILE_TOO_LARGE;
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    error.message = 'Too many files. Maximum is 5 files per request.';
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.FILE_TOO_LARGE;
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error.message = 'Unexpected file field. Check upload configuration.';
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.FILE_UPLOAD_FAILED;
  }
  if (err.code === 'LIMIT_FIELD_KEY') {
    error.message = 'Field name too long.';
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.FILE_UPLOAD_FAILED;
  }
  if (err.code === 'LIMIT_FIELD_VALUE') {
    error.message = 'Field value too long.';
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.FILE_UPLOAD_FAILED;
  }
  
  // Multer fileFilter rejection
  if (err.name === 'MulterError' || (err.message && err.message.includes('not supported'))) {
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.FILE_TYPE_NOT_SUPPORTED;
  }

  // CORS error
  if (err.message === 'Not allowed by CORS') {
    error.message = 'CORS policy violation';
    error.statusCode = 403;
    error.errorCode = 'CORS_VIOLATION';
  }
  
  // ✅ PRODUCTION FIX: Rate limit errors
  if (error.statusCode === 429) {
    error.errorCode = ERROR_CODES.RATE_LIMIT_EXCEEDED;
  }
  
  // ✅ PRODUCTION FIX: Database errors
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    error.errorCode = ERROR_CODES.DATABASE_ERROR;
    // Don't expose internal DB errors in production
    if (process.env.NODE_ENV === 'production') {
      error.message = 'Database operation failed. Please try again.';
    }
  }
  
  // ✅ PRODUCTION FIX: S3 / AWS errors
  if (err.name === 'NoSuchKey' || err.message?.includes('NoSuchKey')) {
    error.message = 'File not found. It may have been deleted or expired.';
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.FILE_UPLOAD_FAILED;
  }
  if (err.name === 'AccessDenied' || err.message?.includes('AccessDenied')) {
    error.message = 'File access denied. Please contact support.';
    error.statusCode = 403;
    error.errorCode = ERROR_CODES.FILE_UPLOAD_FAILED;
  }

  // ✅ PRODUCTION FIX: Enhanced response structure
  const response = {
    success: false,
    message: error.message || 'Internal server error',
    errorCode: error.errorCode || ERROR_CODES.INTERNAL_ERROR,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      originalError: err.name,
    }),
  };

  res.status(error.statusCode).json(response);
};

module.exports = errorHandler;
module.exports.ERROR_CODES = ERROR_CODES; // Export for use in controllers

