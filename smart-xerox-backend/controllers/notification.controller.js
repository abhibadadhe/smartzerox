const Notification = require('../models/Notification');
const { asyncHandler } = require('../utils/helpers');

exports.getMyNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const filter = { recipient: req.user.id };
  if (unreadOnly === 'true') filter.isRead = false;

  const skip = (page - 1) * limit;
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user.id, isRead: false }),
  ]);

  res.status(200).json({
    success: true,
    data: { notifications, unreadCount, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } },
  });
});

exports.markAsRead = asyncHandler(async (req, res) => {
  const { notificationIds } = req.body;
  const filter = { recipient: req.user.id };
  if (notificationIds?.length) filter._id = { $in: notificationIds };

  await Notification.updateMany(filter, { isRead: true, readAt: new Date() });
  res.status(200).json({ success: true, message: 'Notifications marked as read' });
});

exports.markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user.id, isRead: false }, { isRead: true, readAt: new Date() });
  res.status(200).json({ success: true, message: 'All notifications marked as read' });
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user.id });
  res.status(200).json({ success: true, message: 'Notification deleted' });
});

exports.deleteAllNotifications = asyncHandler(async (req, res) => {
  const result = await Notification.deleteMany({ recipient: req.user.id });
  res.status(200).json({ success: true, message: `Deleted ${result.deletedCount} notifications` });
});
