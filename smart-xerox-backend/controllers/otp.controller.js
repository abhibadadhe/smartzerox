/**
 * OTP Controller - Admin & Monitoring Endpoints
 */

const Shop = require('../models/Shop');
const Order = require('../models/Order');
const otpManager = require('../utils/otpManager');
const { AppError, asyncHandler } = require('../utils/helpers');
const logger = require('../config/logger');

// Get OTP statistics for a shop
const getOTPStats = asyncHandler(async (req, res) => {
  const { shopId } = req.params;

  // Verify admin access
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  const stats = await otpManager.getOTPStats(shopId);

  res.status(200).json({
    success: true,
    data: stats
  });
});

// Get all active OTPs for a shop
const getActiveOTPs = asyncHandler(async (req, res) => {
  const { shopId } = req.params;

  // Verify admin access
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  const activeOTPs = await otpManager.getActiveOTPs(shopId);

  res.status(200).json({
    success: true,
    data: {
      shopId,
      count: activeOTPs.length,
      otps: activeOTPs
    }
  });
});

// Reset OTP counter for a shop (admin only)
const resetOTPCounter = asyncHandler(async (req, res) => {
  const { shopId } = req.params;
  const { resetValue = 0 } = req.body;

  // Verify admin access
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  // Validate reset value
  if (typeof resetValue !== 'number' || resetValue < 0 || resetValue > 1000) {
    throw new AppError('Reset value must be a number between 0 and 1000', 400);
  }

  const shop = await otpManager.resetOTPCounter(shopId, resetValue);

  logger.warn(`OTP counter reset by admin ${req.user.id} for shop ${shop.name} (${shopId}) to ${resetValue}`);

  res.status(200).json({
    success: true,
    message: `OTP counter reset to ${resetValue}`,
    data: {
      shopId: shop._id,
      shopName: shop.name,
      otpCounter: shop.otpCounter
    }
  });
});

// System health check - OTP subsystem
const getOTPHealth = asyncHandler(async (req, res) => {
  // Verify admin access
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  try {
    // Get all shops with OTP stats
    const shops = await Shop.find({ isActive: true }).select('_id name otpCounter').lean();

    const stats = await Promise.all(
      shops.map(async (shop) => {
        try {
          const shopStats = await otpManager.getOTPStats(shop._id);
          return {
            ...shopStats,
            status: 'healthy'
          };
        } catch (error) {
          return {
            shopId: shop._id,
            shopName: shop.name,
            status: 'error',
            error: error.message
          };
        }
      })
    );

    // Calculate aggregate stats
    const totalShops = shops.length;
    const healthyShops = stats.filter(s => s.status === 'healthy').length;
    const totalOTPs = stats.reduce((sum, s) => sum + (s.ordersWithOTP || 0), 0);
    const totalPickups = stats.reduce((sum, s) => sum + (s.ordersPickedUp || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        timestamp: new Date(),
        summary: {
          totalShops,
          healthyShops,
          totalOTPs,
          totalPickups,
          healthPercentage: ((healthyShops / totalShops) * 100).toFixed(2) + '%'
        },
        shops: stats
      }
    });
  } catch (error) {
    logger.error(`OTP health check failed: ${error.message}`);
    throw new AppError('Health check failed', 500);
  }
});

// Get OTP generation metrics (for monitoring)
const getOTPMetrics = asyncHandler(async (req, res) => {
  // Verify admin access
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  try {
    // Get metrics from last 24 hours
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalOrders,
      ordersWithOTP,
      ordersPickedUp,
      ordersExpired,
      ordersRejected
    ] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: last24h } }),
      Order.countDocuments({ 
        createdAt: { $gte: last24h },
        'pickup.pickupCode': { $exists: true, $ne: null }
      }),
      Order.countDocuments({ 
        createdAt: { $gte: last24h },
        status: 'picked_up'
      }),
      Order.countDocuments({ 
        createdAt: { $gte: last24h },
        status: 'expired'
      }),
      Order.countDocuments({ 
        createdAt: { $gte: last24h },
        status: 'rejected'
      })
    ]);

    const pickupRate = totalOrders > 0 ? ((ordersPickedUp / totalOrders) * 100).toFixed(2) : 0;
    const otpGenerationRate = totalOrders > 0 ? ((ordersWithOTP / totalOrders) * 100).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      data: {
        period: 'Last 24 hours',
        timestamp: new Date(),
        metrics: {
          totalOrders,
          ordersWithOTP,
          ordersPickedUp,
          ordersExpired,
          ordersRejected,
          pickupRate: pickupRate + '%',
          otpGenerationRate: otpGenerationRate + '%'
        }
      }
    });
  } catch (error) {
    logger.error(`OTP metrics retrieval failed: ${error.message}`);
    throw new AppError('Metrics retrieval failed', 500);
  }
});

// Validate OTP (for testing/debugging)
const validateOTP = asyncHandler(async (req, res) => {
  const { orderId, otp } = req.body;

  // Verify admin access
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  if (!orderId || !otp) {
    throw new AppError('orderId and otp are required', 400);
  }

  const isValid = await otpManager.validateOTP(orderId, otp);

  res.status(200).json({
    success: true,
    data: {
      orderId,
      otp,
      isValid,
      timestamp: new Date()
    }
  });
});

module.exports = {
  getOTPStats,
  getActiveOTPs,
  resetOTPCounter,
  getOTPHealth,
  getOTPMetrics,
  validateOTP
};
