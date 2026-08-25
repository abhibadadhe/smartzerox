const fs = require('fs');

const appendCode = `
// ─── Manual IPP Printer Configuration ─────────────────────────────────────────

// Add a new manual printer by IP
exports.addManualPrinter = asyncHandler(async (req, res) => {
  const { name, type, ipAddress } = req.body;
  // Note: we must require Shop directly if it's not imported. It is imported at the top of printer.controller.js
  const shop = await Shop.findOne({ owner: req.user.id }).lean();
  
  if (!shop) throw new AppError('Shop not found', 404);
  if (!name || !type || !ipAddress) {
    throw new AppError('Name, type, and IP address are required', 400);
  }

  // Create a unique systemName based on name and timestamp
  const systemName = \`Manual_\${name.replace(/\\s+/g, '_')}_\${Date.now()}\`;

  const printer = await Printer.create({
    shop: shop._id,
    name: name.trim(),
    displayName: name.trim(),
    systemName,
    ipAddress: ipAddress.trim(),
    type,
    status: 'running', // Assume online by default
    isEnabled: true
  });

  const { emitToShop } = require('../config/socket');
  emitToShop(shop._id.toString(), 'printer:status_update', { printers: [printer] });

  res.status(201).json({
    success: true,
    message: 'Printer added successfully',
    data: { printer }
  });
});

// Update Printer IP Address
exports.updatePrinterIp = asyncHandler(async (req, res) => {
  const { ipAddress } = req.body;
  const printer = await Printer.findById(req.params.id).populate('shop');
  
  if (!printer) throw new AppError('Printer not found', 404);
  if (printer.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);
  
  if (!ipAddress || ipAddress.trim().length === 0) {
    throw new AppError('IP Address is required', 400);
  }

  printer.ipAddress = ipAddress.trim();
  printer.status = 'running'; 
  await printer.save();

  const { emitToShop } = require('../config/socket');
  emitToShop(printer.shop._id.toString(), 'printer:status_update', { printers: [printer] });

  res.status(200).json({
    success: true,
    message: 'Printer IP updated',
    data: { printer }
  });
});
`;

fs.appendFileSync('controllers/printer.controller.js', appendCode);
console.log('Appended to printer.controller.js');
