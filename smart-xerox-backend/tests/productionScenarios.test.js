/**
 * Production Scenario Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive test scenarios for order processing with mixed color modes,
 * printer routing, and agent communication.
 * 
 * Run with: npm test -- productionScenarios.test.js
 */

'use strict';

const mongoose = require('mongoose');
const {
  validateOrderColorModes,
  validatePrinterAssignments,
  validateShopPrinterCapability,
  validateOrderPricing,
  validateOrderForProduction,
} = require('../utils/productionValidation');

describe('Production Scenarios - Order Processing', () => {
  
  // ─── Scenario 1: Mixed Color/B&W Order with Multiple Ranges ────────────────
  describe('Scenario 1: Mixed Color/B&W Order', () => {
    let order;

    beforeEach(() => {
      order = {
        orderNumber: 'ORD-001',
        documents: [
          {
            _id: new mongoose.Types.ObjectId(),
            originalName: 'Python_Handbook.pdf',
            detectedPages: 61,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 5,
                copies: 2,
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 1,
              },
              {
                rangeStart: 6,
                rangeEnd: 30,
                copies: 1,
                colorMode: 'color',
                sides: 'double',
                pagesPerSheet: 2,
              },
            ],
          },
          {
            _id: new mongoose.Types.ObjectId(),
            originalName: 'OOPS_Notes.pdf',
            detectedPages: 58,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 20,
                copies: 1,
                colorMode: 'color',
                sides: 'single',
                pagesPerSheet: 1,
              },
              {
                rangeStart: 21,
                rangeEnd: 58,
                copies: 3,
                colorMode: 'bw',
                sides: 'double',
                pagesPerSheet: 4,
              },
            ],
          },
        ],
        pricing: {
          subtotal: 500,
          platformMargin: 50,
          additionalServicesCharge: 100,
          total: 600,
          shopReceivable: 550,
        },
        payment: { status: 'paid' },
        pickup: { pickupCode: 123 },
      };
    });

    test('should validate mixed color modes correctly', () => {
      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should detect that order needs division', () => {
      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(true);
      
      // Check that both color and B&W are present
      let hasColor = false, hasBW = false;
      for (const doc of order.documents) {
        for (const range of doc.printingRanges) {
          if (range.colorMode === 'color') hasColor = true;
          if (range.colorMode === 'bw') hasBW = true;
        }
      }
      expect(hasColor).toBe(true);
      expect(hasBW).toBe(true);
    });

    test('should validate pricing for mixed order', () => {
      const shop = { pricing: { bw: { singleSided: 1, doubleSided: 0.5 }, color: { singleSided: 5, doubleSided: 2.5 } } };
      const validation = validateOrderPricing(order, shop);
      expect(validation.isValid).toBe(true);
    });
  });

  // ─── Scenario 2: Color-Only Order ────────────────────────────────────────────
  describe('Scenario 2: Color-Only Order', () => {
    let order, shopPrinters;

    beforeEach(() => {
      order = {
        orderNumber: 'ORD-002',
        documents: [
          {
            _id: new mongoose.Types.ObjectId(),
            originalName: 'Brochure.pdf',
            detectedPages: 10,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 10,
                copies: 5,
                colorMode: 'color',
                sides: 'double',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
        pricing: {
          subtotal: 250,
          platformMargin: 25,
          additionalServicesCharge: 0,
          total: 275,
          shopReceivable: 250,
        },
        payment: { status: 'paid' },
        pickup: { pickupCode: 456 },
        colorMode: 'color',
      };

      shopPrinters = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'HP Color Printer',
          type: 'color',
          isEnabled: true,
          status: 'running',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Brother B&W',
          type: 'bw',
          isEnabled: true,
          status: 'running',
        },
      ];
    });

    test('should validate color-only order', () => {
      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(true);
    });

    test('should confirm shop has color printer capability', () => {
      const validation = validateShopPrinterCapability(order, shopPrinters);
      expect(validation.isValid).toBe(true);
      expect(validation.missingTypes).toHaveLength(0);
    });

    test('should fail if no color printer available', () => {
      const noPrinters = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Brother B&W',
          type: 'bw',
          isEnabled: true,
          status: 'running',
        },
      ];
      
      const validation = validateShopPrinterCapability(order, noPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.missingTypes).toContain('color');
    });
  });

  // ─── Scenario 3: B&W-Only Order ──────────────────────────────────────────────
  describe('Scenario 3: B&W-Only Order', () => {
    let order, shopPrinters;

    beforeEach(() => {
      order = {
        orderNumber: 'ORD-003',
        documents: [
          {
            _id: new mongoose.Types.ObjectId(),
            originalName: 'Notes.pdf',
            detectedPages: 100,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 50,
                copies: 1,
                colorMode: 'bw',
                sides: 'double',
                pagesPerSheet: 2,
              },
              {
                rangeStart: 51,
                rangeEnd: 100,
                copies: 2,
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
        pricing: {
          subtotal: 100,
          platformMargin: 10,
          additionalServicesCharge: 0,
          total: 110,
          shopReceivable: 100,
        },
        payment: { status: 'paid' },
        pickup: { pickupCode: 789 },
        colorMode: 'bw',
      };

      shopPrinters = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Xerox B&W',
          type: 'bw',
          isEnabled: true,
          status: 'running',
        },
      ];
    });

    test('should validate B&W-only order', () => {
      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(true);
    });

    test('should confirm shop has B&W printer capability', () => {
      const validation = validateShopPrinterCapability(order, shopPrinters);
      expect(validation.isValid).toBe(true);
    });

    test('should fail if B&W printer is offline', () => {
      shopPrinters[0].status = 'offline';
      
      const validation = validateShopPrinterCapability(order, shopPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.missingTypes).toContain('bw');
    });
  });

  // ─── Scenario 4: Invalid Range Configuration ──────────────────────────────────
  describe('Scenario 4: Invalid Range Configuration', () => {
    test('should reject range with start > end', () => {
      const order = {
        documents: [
          {
            detectedPages: 50,
            printingRanges: [
              {
                rangeStart: 30,
                rangeEnd: 20, // Invalid: start > end
                copies: 1,
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
      };

      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('Start'))).toBe(true);
    });

    test('should reject range exceeding document pages', () => {
      const order = {
        documents: [
          {
            detectedPages: 50,
            printingRanges: [
              {
                rangeStart: 40,
                rangeEnd: 100, // Invalid: exceeds 50 pages
                copies: 1,
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
      };

      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('exceeds'))).toBe(true);
    });

    test('should reject invalid colorMode', () => {
      const order = {
        documents: [
          {
            detectedPages: 50,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 10,
                copies: 1,
                colorMode: 'grayscale', // Invalid
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
      };

      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('colorMode'))).toBe(true);
    });

    test('should reject invalid pagesPerSheet', () => {
      const order = {
        documents: [
          {
            detectedPages: 50,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 10,
                copies: 1,
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 3, // Invalid: must be 1,2,4,6,9,16
              },
            ],
          },
        ],
      };

      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('pagesPerSheet'))).toBe(true);
    });
  });

  // ─── Scenario 5: Printer Type Mismatch ────────────────────────────────────────
  describe('Scenario 5: Printer Type Mismatch', () => {
    test('should reject color order assigned to B&W printer', () => {
      const order = {
        colorMode: 'color',
        assignedPrinter: new mongoose.Types.ObjectId(),
      };

      const shopPrinters = [
        {
          _id: order.assignedPrinter,
          name: 'Brother B&W',
          type: 'bw', // Mismatch: order is color
          isEnabled: true,
          status: 'running',
        },
      ];

      const validation = validatePrinterAssignments(order, shopPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('type mismatch'))).toBe(true);
    });

    test('should reject B&W order assigned to color printer', () => {
      const order = {
        colorMode: 'bw',
        assignedPrinter: new mongoose.Types.ObjectId(),
      };

      const shopPrinters = [
        {
          _id: order.assignedPrinter,
          name: 'HP Color',
          type: 'color', // Mismatch: order is B&W
          isEnabled: true,
          status: 'running',
        },
      ];

      const validation = validatePrinterAssignments(order, shopPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('type mismatch'))).toBe(true);
    });
  });

  // ─── Scenario 6: Comprehensive Production Validation ────────────────────────
  describe('Scenario 6: Comprehensive Production Validation', () => {
    let order, shop, shopPrinters;

    beforeEach(() => {
      order = {
        orderNumber: 'ORD-006',
        documents: [
          {
            _id: new mongoose.Types.ObjectId(),
            originalName: 'Report.pdf',
            detectedPages: 50,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 25,
                copies: 1,
                colorMode: 'bw',
                sides: 'double',
                pagesPerSheet: 2,
              },
              {
                rangeStart: 26,
                rangeEnd: 50,
                copies: 1,
                colorMode: 'color',
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
        pricing: {
          subtotal: 300,
          platformMargin: 30,
          additionalServicesCharge: 50,
          total: 380,
          shopReceivable: 350,
        },
        payment: { status: 'paid' },
        pickup: { pickupCode: 999 },
      };

      shop = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Smart Print Shop',
        pricing: {
          bw: { singleSided: 1, doubleSided: 0.5 },
          color: { singleSided: 5, doubleSided: 2.5 },
        },
      };

      shopPrinters = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Xerox Color',
          type: 'color',
          isEnabled: true,
          status: 'running',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Brother B&W',
          type: 'bw',
          isEnabled: true,
          status: 'running',
        },
      ];
    });

    test('should pass comprehensive production validation', async () => {
      const validation = await validateOrderForProduction(order, shop, shopPrinters);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.summary.colorModeValid).toBe(true);
      expect(validation.summary.printerCapabilityValid).toBe(true);
      expect(validation.summary.pricingValid).toBe(true);
    });

    test('should fail if color printer is disabled', async () => {
      shopPrinters[0].isEnabled = false;
      
      const validation = await validateOrderForProduction(order, shop, shopPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.summary.printerCapabilityValid).toBe(false);
      expect(validation.summary.missingPrinterTypes).toContain('color');
    });

    test('should fail if B&W printer is offline', async () => {
      shopPrinters[1].status = 'offline';
      
      const validation = await validateOrderForProduction(order, shop, shopPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.summary.printerCapabilityValid).toBe(false);
      expect(validation.summary.missingPrinterTypes).toContain('bw');
    });

    test('should fail if both printers are unavailable', async () => {
      shopPrinters[0].isEnabled = false;
      shopPrinters[1].status = 'offline';
      
      const validation = await validateOrderForProduction(order, shop, shopPrinters);
      expect(validation.isValid).toBe(false);
      expect(validation.summary.missingPrinterTypes).toContain('color');
      expect(validation.summary.missingPrinterTypes).toContain('bw');
    });
  });

  // ─── Scenario 7: Multiple Copies with Different Configurations ──────────────
  describe('Scenario 7: Multiple Copies with Different Configurations', () => {
    test('should handle multiple copies correctly', () => {
      const order = {
        documents: [
          {
            detectedPages: 20,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 10,
                copies: 5, // 5 copies
                colorMode: 'color',
                sides: 'double',
                pagesPerSheet: 2,
              },
              {
                rangeStart: 11,
                rangeEnd: 20,
                copies: 3, // 3 copies
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
      };

      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(true);
    });

    test('should reject invalid copy count', () => {
      const order = {
        documents: [
          {
            detectedPages: 20,
            printingRanges: [
              {
                rangeStart: 1,
                rangeEnd: 10,
                copies: 150, // Invalid: > 100
                colorMode: 'bw',
                sides: 'single',
                pagesPerSheet: 1,
              },
            ],
          },
        ],
      };

      const validation = validateOrderColorModes(order);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('copies'))).toBe(true);
    });
  });
});
