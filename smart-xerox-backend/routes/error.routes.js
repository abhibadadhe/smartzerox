const express = require('express');
const logger = require('../config/logger');

const router = express.Router();

const MAX_FIELD_LENGTH = 4000;

function cleanField(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).slice(0, MAX_FIELD_LENGTH);
}

router.post('/log', (req, res) => {
  const payload = {
    message: cleanField(req.body?.message),
    stack: cleanField(req.body?.stack),
    componentStack: cleanField(req.body?.componentStack),
    url: cleanField(req.body?.url),
    userAgent: cleanField(req.body?.userAgent || req.get('user-agent')),
    timestamp: cleanField(req.body?.timestamp),
    ip: req.ip,
  };

  logger.error(`Frontend error: ${payload.message || 'Unknown error'}`, payload);
  res.status(204).end();
});

module.exports = router;
