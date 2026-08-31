const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect, restrictTo } = require('../middleware/auth');

// Public announcement route (accessible without auth)
router.get('/announcement/public', adminController.getSystemAnnouncement);

router.use(protect, restrictTo('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/analytics', adminController.getAnalytics);
router.get('/revenue', adminController.getRevenueReport);

// Users
router.get('/users', adminController.getAllUsers);
router.patch('/users/:id/toggle-status', adminController.toggleUserStatus);

// Shops
router.get('/shops', adminController.getAllShops);
router.post('/shops/create-with-credentials', adminController.createShopWithCredentials);
router.patch('/shops/:id/verify', adminController.verifyShop);
router.patch('/shops/:id/margin', adminController.setShopMargin);
router.put('/shops/:id/razorpay-account', adminController.updateShopRazorpayAccount);

// Withdrawals
router.get('/withdrawals', adminController.getAllWithdrawals);

// Orders
router.get('/orders', adminController.getAllOrders);

// Broadcast & System Announcements
router.post('/notifications/broadcast', adminController.broadcastNotification);
router.get('/announcement', adminController.getSystemAnnouncement);
router.post('/announcement', adminController.updateSystemAnnouncement);

// Commission settings
router.get('/commission', adminController.getCommissionSettings);
router.patch('/commission', adminController.updateCommissionSettings);
router.post('/commission/apply-all', adminController.applyGlobalCommissionToAllShops);

module.exports = router;
