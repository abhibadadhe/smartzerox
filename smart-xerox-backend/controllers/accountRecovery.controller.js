// ============================================
// ACCOUNT RECOVERY CONTROLLER
// ============================================

const User = require('../models/User');
const { AppError, asyncHandler } = require('../utils/helpers');
const { sendEmail } = require('../utils/email');
const logger = require('../config/logger');
const { checkAccountLockout, trackLoginAttempt } = require('../middleware/security');
const crypto = require('crypto');

// ─── Request Account Unlock ────────────────────────────────────────────────
exports.requestAccountUnlock = asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    throw new AppError('Email is required', 400);
  }
  
  const user = await User.findOne({ email });
  
  // Always return success to prevent email enumeration
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, unlock instructions have been sent.',
    });
  }
  
  // Check if account is actually locked
  const lockoutStatus = checkAccountLockout(email);
  
  if (!lockoutStatus.locked) {
    return res.status(200).json({
      success: true,
      message: 'Your account is not locked. You can login normally.',
    });
  }
  
  // Generate unlock token
  const unlockToken = crypto.randomBytes(32).toString('hex');
  const unlockTokenExpiry = Date.now() + 3600000; // 1 hour
  
  user.accountRecovery = {
    unlockToken: crypto.createHash('sha256').update(unlockToken).digest('hex'),
    unlockTokenExpiry,
    reason: 'Too many failed login attempts',
    requestedAt: new Date(),
  };
  
  await user.save({ validateBeforeSave: false });
  
  // Send unlock email
  const unlockUrl = `${process.env.FRONTEND_URL}/account/unlock/${unlockToken}`;
  
  try {
    await sendEmail({
      to: email,
      subject: 'Account Unlock Request - Smart Xerox',
      template: 'accountUnlock',
      data: {
        name: user.name,
        unlockUrl,
        expiryMinutes: 60,
        lockedUntil: new Date(lockoutStatus.lockedUntil).toLocaleString(),
      },
    });
    
    logger.info(`Account unlock email sent to ${email}`);
  } catch (error) {
    logger.error(`Failed to send unlock email to ${email}: ${error.message}`);
    throw new AppError('Failed to send unlock email. Please try again.', 500);
  }
  
  res.status(200).json({
    success: true,
    message: 'Account unlock instructions have been sent to your email.',
  });
});

// ─── Verify Unlock Token and Unlock Account ────────────────────────────────
exports.unlockAccount = asyncHandler(async (req, res) => {
  const { token } = req.params;
  
  if (!token) {
    throw new AppError('Unlock token is required', 400);
  }
  
  // Hash the token to compare with stored hash
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  
  const user = await User.findOne({
    'accountRecovery.unlockToken': hashedToken,
    'accountRecovery.unlockTokenExpiry': { $gt: Date.now() },
  });
  
  if (!user) {
    throw new AppError('Invalid or expired unlock token', 400);
  }
  
  // Clear the lockout
  trackLoginAttempt(user.email, true);
  
  // Clear recovery data
  user.accountRecovery = undefined;
  await user.save({ validateBeforeSave: false });
  
  logger.info(`Account unlocked successfully: ${user.email}`);
  
  res.status(200).json({
    success: true,
    message: 'Account unlocked successfully. You can now login.',
  });
});

// ─── Request Password Reset (Already exists but enhanced) ──────────────────
exports.requestPasswordReset = asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    throw new AppError('Email is required', 400);
  }
  
  const user = await User.findOne({ email });
  
  // Always return success to prevent email enumeration
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, password reset instructions have been sent.',
    });
  }
  
  // Generate OTP for password reset
  const otp = user.generateOTP('password_reset');
  
  // Also generate a backup reset token (in case OTP fails)
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenExpiry = Date.now() + 3600000; // 1 hour
  
  user.accountRecovery = {
    resetToken: crypto.createHash('sha256').update(resetToken).digest('hex'),
    resetTokenExpiry,
    reason: 'Password reset requested',
    requestedAt: new Date(),
  };
  
  await user.save({ validateBeforeSave: false });
  
  // Send reset email with both OTP and link
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
  
  try {
    await sendEmail({
      to: email,
      subject: 'Password Reset Request - Smart Xerox',
      template: 'passwordReset',
      data: {
        name: user.name,
        otp,
        resetUrl,
        expiryMinutes: 60,
      },
    });
    
    logger.info(`Password reset email sent to ${email}`);
  } catch (error) {
    user.otp = undefined;
    user.accountRecovery = undefined;
    await user.save({ validateBeforeSave: false });
    
    logger.error(`Failed to send reset email to ${email}: ${error.message}`);
    throw new AppError('Failed to send reset email. Please try again.', 500);
  }
  
  res.status(200).json({
    success: true,
    message: 'Password reset instructions have been sent to your email.',
  });
});

// ─── Reset Password with Token (Alternative to OTP) ────────────────────────
exports.resetPasswordWithToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;
  
  if (!token || !newPassword) {
    throw new AppError('Token and new password are required', 400);
  }
  
  // Validate password strength
  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }
  
  // Hash the token to compare with stored hash
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  
  const user = await User.findOne({
    'accountRecovery.resetToken': hashedToken,
    'accountRecovery.resetTokenExpiry': { $gt: Date.now() },
  }).select('+password');
  
  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }
  
  // Check if new password is same as old password
  const isSamePassword = await user.comparePassword(newPassword);
  if (isSamePassword) {
    throw new AppError('New password must be different from current password', 400);
  }
  
  // Update password
  user.password = newPassword;
  user.passwordChangedAt = Date.now();
  user.accountRecovery = undefined;
  user.otp = undefined;
  
  // Clear all refresh tokens (force re-login on all devices)
  user.refreshToken = undefined;
  
  await user.save();
  
  // Clear any account lockout
  trackLoginAttempt(user.email, true);
  
  logger.info(`Password reset successfully for ${user.email}`);
  
  // Send confirmation email
  try {
    await sendEmail({
      to: user.email,
      subject: 'Password Changed Successfully - Smart Xerox',
      template: 'passwordChanged',
      data: {
        name: user.name,
        changedAt: new Date().toLocaleString(),
      },
    });
  } catch (error) {
    logger.warn(`Failed to send password change confirmation to ${user.email}`);
  }
  
  res.status(200).json({
    success: true,
    message: 'Password reset successfully. Please login with your new password.',
  });
});

// ─── Request Account Recovery (Compromised Account) ────────────────────────
exports.requestAccountRecovery = asyncHandler(async (req, res) => {
  const { email, reason } = req.body;
  
  if (!email) {
    throw new AppError('Email is required', 400);
  }
  
  const user = await User.findOne({ email });
  
  // Always return success to prevent email enumeration
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, recovery instructions have been sent.',
    });
  }
  
  // Generate recovery token
  const recoveryToken = crypto.randomBytes(32).toString('hex');
  const recoveryTokenExpiry = Date.now() + 7200000; // 2 hours
  
  user.accountRecovery = {
    recoveryToken: crypto.createHash('sha256').update(recoveryToken).digest('hex'),
    recoveryTokenExpiry,
    reason: reason || 'Account recovery requested',
    requestedAt: new Date(),
  };
  
  await user.save({ validateBeforeSave: false });
  
  // Send recovery email
  const recoveryUrl = `${process.env.FRONTEND_URL}/account/recover/${recoveryToken}`;
  
  try {
    await sendEmail({
      to: email,
      subject: 'Account Recovery Request - Smart Xerox',
      template: 'accountRecovery',
      data: {
        name: user.name,
        recoveryUrl,
        reason: reason || 'Account recovery requested',
        expiryMinutes: 120,
      },
    });
    
    logger.info(`Account recovery email sent to ${email}`);
  } catch (error) {
    logger.error(`Failed to send recovery email to ${email}: ${error.message}`);
    throw new AppError('Failed to send recovery email. Please try again.', 500);
  }
  
  res.status(200).json({
    success: true,
    message: 'Account recovery instructions have been sent to your email.',
  });
});

// ─── Verify Recovery Token and Recover Account ─────────────────────────────
exports.recoverAccount = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { newPassword, newEmail, newPhone } = req.body;
  
  if (!token) {
    throw new AppError('Recovery token is required', 400);
  }
  
  // Hash the token to compare with stored hash
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  
  const user = await User.findOne({
    'accountRecovery.recoveryToken': hashedToken,
    'accountRecovery.recoveryTokenExpiry': { $gt: Date.now() },
  }).select('+password');
  
  if (!user) {
    throw new AppError('Invalid or expired recovery token', 400);
  }
  
  // Update account details
  const updates = [];
  
  if (newPassword) {
    if (newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }
    user.password = newPassword;
    user.passwordChangedAt = Date.now();
    updates.push('password');
  }
  
  if (newEmail) {
    // Check if email is already in use
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser && existingUser._id.toString() !== user._id.toString()) {
      throw new AppError('Email already in use', 409);
    }
    user.email = newEmail;
    user.isEmailVerified = false; // Require re-verification
    updates.push('email');
  }
  
  if (newPhone) {
    // Check if phone is already in use
    const existingUser = await User.findOne({ phone: newPhone });
    if (existingUser && existingUser._id.toString() !== user._id.toString()) {
      throw new AppError('Phone number already in use', 409);
    }
    user.phone = newPhone;
    user.isPhoneVerified = false; // Require re-verification
    updates.push('phone');
  }
  
  // Clear recovery data and all sessions
  user.accountRecovery = undefined;
  user.refreshToken = undefined;
  user.otp = undefined;
  
  await user.save();
  
  // Clear any account lockout
  trackLoginAttempt(user.email, true);
  
  logger.info(`Account recovered successfully for ${user.email}. Updated: ${updates.join(', ')}`);
  
  // Send confirmation email
  try {
    await sendEmail({
      to: user.email,
      subject: 'Account Recovered Successfully - Smart Xerox',
      template: 'accountRecovered',
      data: {
        name: user.name,
        updatedFields: updates.join(', '),
        recoveredAt: new Date().toLocaleString(),
      },
    });
  } catch (error) {
    logger.warn(`Failed to send recovery confirmation to ${user.email}`);
  }
  
  res.status(200).json({
    success: true,
    message: 'Account recovered successfully. Please login with your new credentials.',
    data: {
      updatedFields: updates,
    },
  });
});

// ─── Check Recovery Status ──────────────────────────────────────────────────
exports.checkRecoveryStatus = asyncHandler(async (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    throw new AppError('Email is required', 400);
  }
  
  // Check account lockout status
  const lockoutStatus = checkAccountLockout(email);
  
  res.status(200).json({
    success: true,
    data: {
      isLocked: lockoutStatus.locked,
      lockedUntil: lockoutStatus.lockedUntil || null,
      canRequestUnlock: lockoutStatus.locked,
      canRequestPasswordReset: true,
    },
  });
});

// ─── Request Email Change Verification ──────────────────────────────────────
exports.requestEmailChange = asyncHandler(async (req, res) => {
  const { newEmail } = req.body;
  const userId = req.user.id;
  
  if (!newEmail) {
    throw new AppError('New email is required', 400);
  }
  
  // Check if email is already in use
  const existingUser = await User.findOne({ email: newEmail });
  if (existingUser) {
    throw new AppError('Email already in use', 409);
  }
  
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  
  // Generate OTP for email change
  const otp = user.generateOTP('email_change');
  
  // Store new email temporarily
  user.accountRecovery = {
    pendingEmail: newEmail,
    pendingEmailExpiry: Date.now() + 900000, // 15 minutes
    requestedAt: new Date(),
  };
  
  await user.save({ validateBeforeSave: false });
  
  // Send OTP to new email
  try {
    await sendEmail({
      to: newEmail,
      subject: 'Verify Email Change - Smart Xerox',
      template: 'emailChangeVerification',
      data: {
        name: user.name,
        otp,
        expiryMinutes: 15,
      },
    });
    
    logger.info(`Email change OTP sent to ${newEmail} for user ${user.email}`);
  } catch (error) {
    user.otp = undefined;
    user.accountRecovery = undefined;
    await user.save({ validateBeforeSave: false });
    
    throw new AppError('Failed to send verification email. Please try again.', 500);
  }
  
  res.status(200).json({
    success: true,
    message: 'Verification code sent to your new email address.',
  });
});

// ─── Verify Email Change ────────────────────────────────────────────────────
exports.verifyEmailChange = asyncHandler(async (req, res) => {
  const { otp } = req.body;
  const userId = req.user.id;
  
  if (!otp) {
    throw new AppError('OTP is required', 400);
  }
  
  const user = await User.findById(userId).select('+otp.code +otp.expiresAt +otp.purpose +otp.attempts');
  
  if (!user) {
    throw new AppError('User not found', 404);
  }
  
  if (!user.accountRecovery?.pendingEmail) {
    throw new AppError('No pending email change request', 400);
  }
  
  if (user.accountRecovery.pendingEmailExpiry < Date.now()) {
    throw new AppError('Email change request expired. Please try again.', 400);
  }
  
  // Verify OTP
  const result = user.verifyOTP(otp, 'email_change');
  if (!result.valid) {
    throw new AppError(result.message, 400);
  }
  
  // Update email
  const oldEmail = user.email;
  user.email = user.accountRecovery.pendingEmail;
  user.isEmailVerified = true;
  user.accountRecovery = undefined;
  
  await user.save({ validateBeforeSave: false });
  
  logger.info(`Email changed from ${oldEmail} to ${user.email}`);
  
  // Send confirmation to both emails
  try {
    await sendEmail({
      to: oldEmail,
      subject: 'Email Address Changed - Smart Xerox',
      template: 'emailChanged',
      data: {
        name: user.name,
        newEmail: user.email,
        changedAt: new Date().toLocaleString(),
      },
    });
  } catch (error) {
    logger.warn(`Failed to send confirmation to old email ${oldEmail}`);
  }
  
  res.status(200).json({
    success: true,
    message: 'Email address updated successfully.',
    data: {
      newEmail: user.email,
    },
  });
});

module.exports = exports;
