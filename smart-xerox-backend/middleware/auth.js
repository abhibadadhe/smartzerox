const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../utils/helpers');
const logger = require('../config/logger');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  // Try to get token from cookies first, then Authorization header
  if (req.cookies?.jwt && req.cookies.jwt !== 'loggedout') {
    token = req.cookies.jwt;
  } else if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    logger.warn(`Auth: No token provided for ${req.method} ${req.path} from ${req.ip}`);
    throw new AppError('Authentication required. Please log in.', 401);
  }

  // Explicitly specify algorithm — prevents algorithm confusion attacks (e.g. RS256 → HS256 swap)
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    logger.warn(`Auth: JWT verification failed: ${err.name} - ${err.message}`);

    // On any expired access token, attempt a silent refresh via refresh token
    if (err.name === 'TokenExpiredError') {
      const refreshToken = req.cookies?.refreshToken || req.headers['x-refresh-token'];
      if (refreshToken) {
        try {
          const refreshDecoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
          const user = await User.findById(refreshDecoded.id).select('+refreshToken');
          if (user && user.isActive && user.refreshToken === refreshToken) {
            // Issue new access token and rotate refresh token
            const newToken = jwt.sign(
              { id: user._id, role: user.role },
              process.env.JWT_SECRET,
              { expiresIn: process.env.JWT_EXPIRES_IN, algorithm: 'HS256' }
            );
            const newRefreshToken = jwt.sign(
              { id: user._id },
              process.env.JWT_REFRESH_SECRET,
              { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' }
            );
            user.refreshToken = newRefreshToken;
            await user.save({ validateBeforeSave: false });

            // Return new tokens in response headers so the client can store them
            res.setHeader('x-new-token', newToken);
            res.setHeader('x-refresh-token', newRefreshToken);
            logger.info(`Auth: Tokens silently rotated for user ${user._id}`);
            decoded = refreshDecoded;
          } else {
            logger.warn(`Auth: Refresh token mismatch or inactive user for ${refreshDecoded.id}`);
            // Return a specific code so the client knows to re-login
            const tokenErr = new AppError('Session expired. Please log in again.', 401);
            tokenErr.code = 'TOKEN_EXPIRED';
            throw tokenErr;
          }
        } catch (refreshErr) {
          if (refreshErr.code === 'TOKEN_EXPIRED') throw refreshErr;
          logger.warn(`Auth: Refresh token invalid: ${refreshErr.message}`);
          const tokenErr = new AppError('Session expired. Please log in again.', 401);
          tokenErr.code = 'TOKEN_EXPIRED';
          throw tokenErr;
        }
      } else {
        // No refresh token available — let client know it should redirect to login
        const tokenErr = new AppError('Session expired. Please log in again.', 401);
        tokenErr.code = 'TOKEN_EXPIRED';
        throw tokenErr;
      }
    } else {
      throw err;
    }
  }

  const user = await User.findById(decoded.id).select('+passwordChangedAt');
  if (!user) {
    logger.warn(`Auth: User ${decoded.id} not found`);
    throw new AppError('User no longer exists', 401);
  }
  
  if (!user.isActive) {
    logger.warn(`Auth: User ${user._id} account deactivated`);
    throw new AppError('Account deactivated. Contact support.', 403);
  }

  if (user.changedPasswordAfter(decoded.iat)) {
    logger.warn(`Auth: Password changed after token issued for user ${user._id}`);
    throw new AppError('Password recently changed. Please log in again.', 401);
  }

  // Attach user info to request
  req.user = { id: user._id.toString(), role: user.role, email: user.email };
  logger.debug(`Auth: User ${req.user.id} authenticated`);
  next();
});

exports.restrictTo = (...roles) => (req, res, next) => {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  
  if (!roles.includes(req.user.role)) {
    logger.warn(`Auth: User ${req.user.id} (role: ${req.user.role}) denied access to restricted route`);
    throw new AppError('You do not have permission to perform this action', 403);
  }
  next();
};

exports.optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  // NEW — Also check cookie for optional auth
  if (req.cookies?.jwt && req.cookies.jwt !== 'loggedout') {
    token = req.cookies.jwt;
  } else if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      const user = await User.findById(decoded.id);
      if (user && user.isActive) {
        req.user = { id: user._id.toString(), role: user.role, email: user.email };
      }
    } catch (err) {
      logger.debug(`Auth: Optional auth failed: ${err.name}`);
      // Ignore auth errors for optional auth
    }
  }
  next();
});