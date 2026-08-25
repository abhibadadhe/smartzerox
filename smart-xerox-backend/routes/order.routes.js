const express = require('express');
const router  = express.Router();
const orderController = require('../controllers/order.controller');
const { protect, restrictTo } = require('../middleware/auth');
const { validateObjectId } = require('../middleware/validate');

router.use(protect);

// ── Named routes MUST come before /:id wildcards ──────────────────────────────
router.post('/',               orderController.createOrder);
router.get('/my-orders',       orderController.getUserOrders);
router.post('/verify-pickup',  restrictTo('shopkeeper', 'admin'), orderController.verifyPickup);
router.get('/shop/orders',     restrictTo('shopkeeper', 'admin'), orderController.getShopOrders);
router.get('/incomplete-jobs', restrictTo('shopkeeper'),          orderController.getIncompletePrintJobs);
router.post('/retry/:id',      validateObjectId('id'), orderController.retryPayment);

// ── Order Division Routes (sub-orders) ────────────────────────────────────────
router.get('/:parentOrderId/sub-orders', validateObjectId('parentOrderId'), orderController.getSubOrders);
router.get('/:subOrderId/parent-order', validateObjectId('subOrderId'), orderController.getParentOrder);
router.get('/:orderId/division-status', validateObjectId('orderId'), orderController.getOrderDivisionStatus);

// ── Wildcard /:id routes — MUST be LAST ──────────────────────────────────────
router.use('/:id', validateObjectId('id'));
router.get('/:id/retry-payment',  orderController.retryPayment);
router.get('/:id/print-job',      restrictTo('shopkeeper'),       orderController.getPrintJobStatus);
router.patch('/:id/print-job',    restrictTo('shopkeeper'),       orderController.updatePrintJob);
router.patch('/:id/reassign-printer', restrictTo('shopkeeper'),   orderController.reassignPrinter);
router.post('/:id/resume-print',  restrictTo('shopkeeper'),       orderController.resumePrintJob);
router.post('/:id/trigger-print', restrictTo('shopkeeper'),       orderController.triggerHardwarePrint);
router.get('/:id',                orderController.getOrder);
router.post('/:id/extend',        orderController.extendOrderExpiry);
router.post('/:id/rate',          orderController.rateOrder);
router.patch('/:id/accept',       restrictTo('shopkeeper'),          orderController.acceptOrder);
router.patch('/:id/reject',       restrictTo('shopkeeper', 'admin'), orderController.rejectOrder);
router.patch('/:id/status',       restrictTo('shopkeeper'),          orderController.updateOrderStatus);
router.patch('/:id/auto-printed', restrictTo('shopkeeper'),          orderController.markAutoPrinted);
router.patch('/:id/print-incomplete', restrictTo('shopkeeper'),       orderController.markPrintIncomplete);
router.post('/:id/retry-incomplete',  restrictTo('shopkeeper'),       orderController.retryIncompletePrint);
router.delete('/:id',             orderController.deleteOrder);
router.delete('/',                restrictTo('admin'), orderController.deleteOldOrders);
router.get('/:orderId/documents/:docId/url',
  validateObjectId('orderId', 'docId'),
  restrictTo('shopkeeper', 'admin'),
  orderController.getDocumentUrl
);

module.exports = router;
