const Notification = require('../models/Notification');
const logger = require('../config/logger');

/**
 * Create and optionally emit a notification
 */
const createNotification = async ({ recipient, type, title, message, data, order, shop, priority = 'medium' }) => {
  try {
    const notification = await Notification.create({
      recipient,
      type,
      title,
      message,
      data,
      order,
      shop,
      priority,
    });
    return notification;
  } catch (err) {
    logger.error('Failed to create notification:', err.message);
    return null;
  }
};

/**
 * Bulk create notifications (for admin broadcasts)
 */
const createBulkNotifications = async (notifications) => {
  try {
    return await Notification.insertMany(notifications, { ordered: false });
  } catch (err) {
    logger.error('Bulk notification creation failed:', err.message);
    return [];
  }
};

module.exports = { createNotification, createBulkNotifications };
