const express = require('express');
const router = express.Router();
const notifController = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/', notifController.getMyNotifications);
router.patch('/read', notifController.markAsRead);
router.patch('/read-all', notifController.markAllAsRead);
router.delete('/:id', notifController.deleteNotification);
router.delete('/', notifController.deleteAllNotifications);

module.exports = router;
