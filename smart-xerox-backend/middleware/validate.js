const { AppError } = require('../utils/helpers');

exports.validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const messages = error.details.map((d) => d.message).join('. ');
    return next(new AppError(messages, 400));
  }
  req.body = value;
  next();
};

exports.validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) {
    const messages = error.details.map((d) => d.message).join('. ');
    return next(new AppError(messages, 400));
  }
  req.query = value;
  next();
};

// ─── Validate MongoDB ObjectId params ────────────────────────────────────────
// Prevents CastError crashes and NoSQL injection via malformed IDs
exports.validateObjectId = (...paramNames) => (req, res, next) => {
  const { AppError } = require('../utils/helpers');
  const objectIdRegex = /^[a-f\d]{24}$/i;
  for (const param of paramNames) {
    const val = req.params[param];
    if (val && !objectIdRegex.test(val)) {
      return next(new AppError(`Invalid ID format for parameter: ${param}`, 400));
    }
  }
  next();
};
