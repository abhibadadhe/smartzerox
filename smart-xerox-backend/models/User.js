const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian phone number'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'shopkeeper', 'admin'],
      default: 'user',
    },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    avatar: { type: String, default: null },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
    },
    otp: {
      code: { type: String, select: false },
      expiresAt: { type: Date, select: false },
      purpose: { type: String, enum: ['email_verify', 'phone_verify', 'login', 'password_reset', 'email_change'], select: false },
      attempts: { type: Number, default: 0, select: false },
    },
    accountRecovery: {
      unlockToken: { type: String, select: false },
      unlockTokenExpiry: { type: Date, select: false },
      resetToken: { type: String, select: false },
      resetTokenExpiry: { type: Date, select: false },
      recoveryToken: { type: String, select: false },
      recoveryTokenExpiry: { type: Date, select: false },
      pendingEmail: { type: String, select: false },
      pendingEmailExpiry: { type: Date, select: false },
      reason: { type: String, select: false },
      requestedAt: { type: Date, select: false },
    },
    refreshToken: { type: String, select: false },
    passwordChangedAt: { type: Date },
    lastLogin: { type: Date },
    lastDeviceFingerprint: { type: String, select: false },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' }, // For shopkeepers
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    fcmToken: { type: String, default: null }, // Push notifications
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
  this.password = await bcrypt.hash(this.password, saltRounds);
  if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if password was changed after token was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Generate OTP
userSchema.methods.generateOTP = function (purpose) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000),
    purpose,
    attempts: 0,
  };
  return otp;
};

// Verify OTP
userSchema.methods.verifyOTP = function (inputOTP, purpose) {
  if (!this.otp || !this.otp.code) return { valid: false, message: 'No OTP generated' };
  if (this.otp.expiresAt < Date.now()) return { valid: false, message: 'OTP expired' };
  if (this.otp.purpose !== purpose) return { valid: false, message: 'Invalid OTP purpose' };
  if (this.otp.attempts >= 5) return { valid: false, message: 'Too many OTP attempts' };
  if (this.otp.code !== inputOTP) {
    this.otp.attempts += 1;
    return { valid: false, message: 'Invalid OTP' };
  }
  this.otp = undefined;
  return { valid: true };
};

module.exports = mongoose.model('User', userSchema);
