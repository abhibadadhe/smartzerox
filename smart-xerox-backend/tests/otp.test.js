/**
 * OTP System Tests - Production-Ready
 * 
 * Tests:
 * - Sequential OTP generation (1-1000 cycle)
 * - Atomic operations (no race conditions)
 * - OTP validation
 * - Reset after 1000
 * - Concurrent request handling
 */

const mongoose = require('mongoose');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const User = require('../models/User');
const otpManager = require('../utils/otpManager');

// Mock data
const mockShopData = {
  name: 'Test Xerox Shop',
  owner: new mongoose.Types.ObjectId(),
  phone: '9876543210',
  address: {
    street: '123 Main St',
    city: 'Test City',
    state: 'Test State',
    pincode: '123456'
  },
  location: {
    type: 'Point',
    coordinates: [72.8479, 19.0176]
  },
  pricing: {
    bw: { singleSided: 2, doubleSided: 3 },
    color: { singleSided: 10, doubleSided: 15 }
  }
};

const mockUserData = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '9876543210',
  password: 'hashedPassword123'
};

const mockOrderData = {
  documents: [{
    originalName: 'test.pdf',
    s3Key: 'test-key',
    s3Url: 'https://s3.example.com/test',
    detectedPages: 10,
    printingRanges: [{ rangeStart: 1, rangeEnd: 10, copies: 1 }]
  }],
  pricing: {
    subtotal: 100,
    total: 100,
    shopReceivable: 90
  },
  status: 'ready'
};

describe('OTP System - Production Ready', () => {
  let shopId, userId, orderId;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smart_xerox_test');
    }
  });

  afterAll(async () => {
    // Cleanup
    if (shopId) await Shop.findByIdAndDelete(shopId);
    if (userId) await User.findByIdAndDelete(userId);
    if (orderId) await Order.findByIdAndDelete(orderId);
    await mongoose.connection.close();
  });

  describe('Sequential OTP Generation', () => {
    test('should generate OTP starting from 1', async () => {
      // Create shop
      const shop = await Shop.create(mockShopData);
      shopId = shop._id;

      const otp = await Shop.nextOtpCounter(shopId);
      expect(otp).toBe('1');
    });

    test('should increment OTP sequentially', async () => {
      const otp1 = await Shop.nextOtpCounter(shopId);
      const otp2 = await Shop.nextOtpCounter(shopId);
      const otp3 = await Shop.nextOtpCounter(shopId);

      expect(parseInt(otp1)).toBe(2);
      expect(parseInt(otp2)).toBe(3);
      expect(parseInt(otp3)).toBe(4);
    });

    test('should reset to 1 after reaching 1000', async () => {
      // Set counter to 999
      await Shop.findByIdAndUpdate(shopId, { otpCounter: 999 });

      const otp999 = await Shop.nextOtpCounter(shopId);
      const otp1000 = await Shop.nextOtpCounter(shopId);
      const otpReset = await Shop.nextOtpCounter(shopId);

      expect(otp999).toBe('1000');
      expect(otp1000).toBe('1');
      expect(otpReset).toBe('2');
    });
  });

  describe('Atomic Operations (Race Condition Prevention)', () => {
    test('should handle concurrent OTP requests without duplicates', async () => {
      // Reset counter
      await Shop.findByIdAndUpdate(shopId, { otpCounter: 0 });

      // Simulate 10 concurrent requests
      const promises = Array(10).fill(null).map(() => 
        Shop.nextOtpCounter(shopId)
      );

      const otps = await Promise.all(promises);
      const uniqueOtps = new Set(otps);

      // All OTPs should be unique
      expect(uniqueOtps.size).toBe(10);
      
      // OTPs should be sequential
      const sortedOtps = otps.map(Number).sort((a, b) => a - b);
      for (let i = 0; i < sortedOtps.length; i++) {
        expect(sortedOtps[i]).toBe(i + 1);
      }
    });

    test('should handle 1000+ concurrent requests with proper cycling', async () => {
      // Reset counter
      await Shop.findByIdAndUpdate(shopId, { otpCounter: 0 });

      // Simulate 1050 concurrent requests (should cycle)
      const promises = Array(1050).fill(null).map(() => 
        Shop.nextOtpCounter(shopId)
      );

      const otps = await Promise.all(promises);
      
      // Should have no duplicates in first 1000
      const first1000 = otps.slice(0, 1000);
      const uniqueFirst1000 = new Set(first1000);
      expect(uniqueFirst1000.size).toBe(1000);

      // After 1000, should start from 1 again
      expect(otps[1000]).toBe('1');
      expect(otps[1001]).toBe('2');
    });
  });

  describe('OTP Manager Utility', () => {
    test('should generate OTP via manager', async () => {
      const otp = await otpManager.generateOTP(shopId);
      expect(otp).toBeDefined();
      expect(parseInt(otp)).toBeGreaterThan(0);
      expect(parseInt(otp)).toBeLessThanOrEqual(1000);
    });

    test('should get OTP statistics', async () => {
      const stats = await otpManager.getOTPStats(shopId);
      
      expect(stats).toHaveProperty('shopId');
      expect(stats).toHaveProperty('currentCounter');
      expect(stats).toHaveProperty('nextOTP');
      expect(stats).toHaveProperty('ordersWithOTP');
      expect(stats).toHaveProperty('cyclesCompleted');
    });

    test('should validate OTP correctly', async () => {
      // Create user and order
      const user = await User.create(mockUserData);
      userId = user._id;

      const order = await Order.create({
        ...mockOrderData,
        user: userId,
        shop: shopId,
        pickup: {
          pickupCode: '123',
          qrCodeData: 'test-qr'
        }
      });
      orderId = order._id;

      // Valid OTP
      const isValid = await otpManager.validateOTP(orderId, '123');
      expect(isValid).toBe(true);

      // Invalid OTP
      const isInvalid = await otpManager.validateOTP(orderId, '456');
      expect(isInvalid).toBe(false);
    });

    test('should consume OTP', async () => {
      const consumed = await otpManager.consumeOTP(orderId);
      
      expect(consumed.pickup.pickupCode).toBeUndefined();
      expect(consumed.pickup.qrCode).toBeUndefined();
    });

    test('should reset OTP counter', async () => {
      const reset = await otpManager.resetOTPCounter(shopId, 0);
      expect(reset.otpCounter).toBe(0);

      const nextOtp = await Shop.nextOtpCounter(shopId);
      expect(nextOtp).toBe('1');
    });
  });

  describe('Error Handling', () => {
    test('should throw error for invalid shop ID', async () => {
      const invalidId = new mongoose.Types.ObjectId();
      
      await expect(Shop.nextOtpCounter(invalidId))
        .rejects
        .toThrow();
    });

    test('should throw error for null shop ID', async () => {
      await expect(Shop.nextOtpCounter(null))
        .rejects
        .toThrow();
    });

    test('should handle validation errors gracefully', async () => {
      await expect(otpManager.resetOTPCounter(shopId, 1001))
        .rejects
        .toThrow('Reset value must be between 0 and 1000');
    });
  });

  describe('Production Load Test', () => {
    test('should handle 10000 sequential OTP generations', async () => {
      // Reset counter
      await Shop.findByIdAndUpdate(shopId, { otpCounter: 0 });

      const startTime = Date.now();
      let lastOtp = 0;

      // Generate 10000 OTPs
      for (let i = 0; i < 10000; i++) {
        const otp = await Shop.nextOtpCounter(shopId);
        const otpNum = parseInt(otp);
        
        // Verify cycling
        if (i < 1000) {
          expect(otpNum).toBe(i + 1);
        } else {
          const expectedOtp = ((i % 1000) + 1);
          expect(otpNum).toBe(expectedOtp);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`Generated 10000 OTPs in ${duration}ms (${(duration/10000).toFixed(2)}ms per OTP)`);
      
      // Should complete in reasonable time (< 30 seconds)
      expect(duration).toBeLessThan(30000);
    });
  });
});

// Export for use in other test suites
module.exports = {
  mockShopData,
  mockUserData,
  mockOrderData
};
