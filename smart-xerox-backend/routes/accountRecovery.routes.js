// ============================================
// ACCOUNT RECOVERY ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const accountRecoveryController = require('../controllers/accountRecovery.controller');
const { protect } = require('../middleware/auth');
const { auditLog } = require('../middleware/security');

// ─── Public Routes (No Authentication Required) ────────────────────────────

// Check recovery status
router.get(
  '/status',
  accountRecoveryController.checkRecoveryStatus
);

// Request account unlock (for locked accounts)
router.post(
  '/unlock/request',
  auditLog('account_unlock_request'),
  accountRecoveryController.requestAccountUnlock
);

// Verify unlock token and unlock account
router.post(
  '/unlock/:token',
  auditLog('account_unlock'),
  accountRecoveryController.unlockAccount
);

// Request password reset
router.post(
  '/password-reset/request',
  auditLog('password_reset_request'),
  accountRecoveryController.requestPasswordReset
);

// Reset password with token (alternative to OTP)
router.post(
  '/password-reset/:token',
  auditLog('password_reset'),
  accountRecoveryController.resetPasswordWithToken
);

// Request full account recovery (compromised account)
router.post(
  '/recover/request',
  auditLog('account_recovery_request'),
  accountRecoveryController.requestAccountRecovery
);

// Verify recovery token and recover account
router.post(
  '/recover/:token',
  auditLog('account_recovery'),
  accountRecoveryController.recoverAccount
);

// ─── Protected Routes (Authentication Required) ─────────────────────────────

// Request email change
router.post(
  '/email/change',
  protect,
  auditLog('email_change_request'),
  accountRecoveryController.requestEmailChange
);

// Verify email change
router.post(
  '/email/verify',
  protect,
  auditLog('email_change_verify'),
  accountRecoveryController.verifyEmailChange
);

module.exports = router;
