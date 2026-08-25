const express = require('express');
const userRouter = express.Router();
const notifRouter = express.Router();
const userController = require('../controllers/user.controller');
const notifController = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth');

// User routes
userRouter.use(protect);
userRouter.get('/profile', userController.getProfile);
userRouter.patch('/profile', userController.updateProfile);
userRouter.get('/orders', userController.getOrderHistory);
userRouter.get('/stats', userController.getUserStats);

// Notification routes
notifRouter.use(protect);
notifRouter.get('/', notifController.getMyNotifications);
notifRouter.patch('/read', notifController.markAsRead);
notifRouter.patch('/read-all', notifController.markAllAsRead);
notifRouter.delete('/:id', notifController.deleteNotification);

module.exports = { userRouter, notifRouter };
