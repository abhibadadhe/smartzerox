/**
 * kit.advanced-fraud.js — Legacy V1 shim
 *
 * The controller imports getAdvancedFraudStats from here.
 * We now route everything through the unified V2 engine.
 * This file kept only for backward-compat import resolution.
 */

'use strict';

const { getFraudStats } = require('./kit.fraud');

// getAdvancedFraudStats is the same as getFraudStats — re-export with the old name
module.exports = {
  getAdvancedFraudStats: getFraudStats,
};
