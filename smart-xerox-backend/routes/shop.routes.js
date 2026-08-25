const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shop.controller');
const { protect, restrictTo } = require('../middleware/auth');

router.get('/', shopController.getAllShops);
router.get('/nearby', shopController.getNearbyShops);

// /my-shop routes must come BEFORE /:id
router.get('/my-shop/dashboard', protect, restrictTo('shopkeeper'), shopController.getShopDashboard);
router.get('/my-shop', protect, restrictTo('shopkeeper'), shopController.getMyShop);
router.patch('/my-shop', protect, restrictTo('shopkeeper'), shopController.updateShop);
router.get('/my-shop/reviews', protect, restrictTo('shopkeeper'), shopController.getShopReviews);
router.get('/my-shop/withdrawals', protect, restrictTo('shopkeeper'), shopController.getWithdrawals);
router.post('/my-shop/withdraw', protect, restrictTo('shopkeeper'), shopController.requestWithdrawal);
router.patch('/my-shop/toggle-status', protect, restrictTo('shopkeeper'), shopController.toggleShopStatus);

router.post('/', protect, restrictTo('shopkeeper'), shopController.createShop);
router.get('/:id', shopController.getShop);
router.get('/:id/reviews', shopController.getShopReviews);

module.exports = router;
