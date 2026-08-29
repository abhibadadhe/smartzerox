const express = require('express');
const router = express.Router();
const printerController = require('../controllers/printer.controller');
const {
  reportLanDetection, protect, restrictTo } = require('../middleware/auth');
const { validateObjectId } = require('../middleware/validate');

router.use(protect);

router.get('/my-shop', restrictTo('shopkeeper'), printerController.getShopPrinters);
router.get('/load-stats', restrictTo('shopkeeper'), printerController.getLoadBalancerStats);
router.post('/register', restrictTo('shopkeeper'), printerController.registerPrinters);
router.post('/heartbeat', restrictTo('shopkeeper'), printerController.heartbeat);
router.post('/decrease-load', restrictTo('shopkeeper'), printerController.decreaseLoad);
router.get('/optimal', restrictTo('shopkeeper'), printerController.getOptimalPrinter);
router.post('/scan', restrictTo('shopkeeper'), printerController.scanPrinters);
router.post('/reset-all', restrictTo('shopkeeper'), printerController.resetAllPrinters);
router.post('/mark-stale-offline', restrictTo('admin'), printerController.markStaleOffline);
router.post('/manual', restrictTo('shopkeeper'), printerController.addManualPrinter);

router.patch('/:id/toggle', validateObjectId('id'), restrictTo('shopkeeper'), printerController.togglePrinter);
router.patch('/:id/display-name', validateObjectId('id'), restrictTo('shopkeeper'), printerController.updatePrinterDisplayName);
router.patch('/:id/status', validateObjectId('id'), restrictTo('shopkeeper'), printerController.updatePrinterStatus);
router.patch('/:id/decrease-load', validateObjectId('id'), restrictTo('shopkeeper'), printerController.decreasePrinterLoad);
router.patch('/:id/ip', validateObjectId('id'), restrictTo('shopkeeper'), printerController.updatePrinterIp);
router.post('/:id/lan-detect-report', authenticate, reportLanDetection);
router.post('/:id/detect-formats', validateObjectId('id'), restrictTo('shopkeeper'), printerController.detectFormats);

module.exports = router;
