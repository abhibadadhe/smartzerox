const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const Joi = require('joi');

const updateProfileSchema = Joi.object({
  name:     Joi.string().min(2).max(50).trim(),
  address:  Joi.object({
    street:  Joi.string().max(200).trim(),
    city:    Joi.string().max(100).trim(),
    state:   Joi.string().max(100).trim(),
    pincode: Joi.string().pattern(/^\d{6}$/).message('Invalid pincode'),
  }),
  fcmToken: Joi.string().max(500).allow('', null),
});

const changeShopSchema = Joi.object({
  shopId: Joi.string().hex().length(24).required().messages({
    'string.hex':    'Invalid shop ID',
    'string.length': 'Invalid shop ID',
  }),
});

router.use(protect);
router.get('/profile',      userController.getProfile);
router.patch('/profile',    validateBody(updateProfileSchema), userController.updateProfile);
router.get('/orders',       userController.getOrderHistory);
router.get('/stats',        userController.getUserStats);
router.patch('/change-shop', validateBody(changeShopSchema), userController.changeShop);

module.exports = router;
