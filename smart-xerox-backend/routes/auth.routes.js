const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const Joi = require('joi');

const registerSchema = Joi.object({
  name:     Joi.string().min(2).max(50).required(),
  email:    Joi.string().email().required(),
  phone:    Joi.string().pattern(/^[6-9]\d{9}$/).required().messages({ 'string.pattern.base': 'Invalid Indian phone number' }),
  password: Joi.string().min(8).pattern(/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/).required().messages({ 'string.pattern.base': 'Password must be at least 8 characters with at least one letter and one number' }),
  role:     Joi.string().valid('user', 'shopkeeper').default('user'),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

router.post('/register',         validateBody(registerSchema), authController.register);
router.post('/verify-email',     authController.verifyEmail);
router.post('/resend-otp',       authController.resendOTP);        // NEW — resend registration OTP
router.post('/login',            validateBody(loginSchema), authController.login);
router.post('/send-otp',         authController.sendLoginOTP);
router.post('/verify-otp',       authController.verifyLoginOTP);
router.post('/refresh-token',    authController.refreshToken);
router.post('/forgot-password',  authController.forgotPassword);
router.post('/reset-password',   authController.resetPassword);
router.post('/logout',           protect, authController.logout);
router.get('/me',                protect, authController.getMe);
router.patch('/change-password', protect, authController.changePassword);

module.exports = router;