#!/usr/bin/env node

/**
 * Verify Backend Setup
 * Checks all critical configurations before startup
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const checks = [];
let passed = 0;
let failed = 0;

function check(name, condition, errorMsg) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}: ${errorMsg}`);
    failed++;
  }
  checks.push({ name, passed: condition });
}

console.log('\n🔍 Verifying Backend Setup...\n');

// Environment variables
check('NODE_ENV set', process.env.NODE_ENV, 'NODE_ENV not set');
check('PORT configured', process.env.PORT, 'PORT not set');
check('MONGODB_URI configured', process.env.MONGODB_URI, 'MONGODB_URI not set');
check('JWT_SECRET configured', process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32, 'JWT_SECRET too short or not set');
check('JWT_REFRESH_SECRET configured', process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length >= 32, 'JWT_REFRESH_SECRET too short or not set');
check('AWS_ACCESS_KEY_ID configured', process.env.AWS_ACCESS_KEY_ID, 'AWS_ACCESS_KEY_ID not set');
check('AWS_SECRET_ACCESS_KEY configured', process.env.AWS_SECRET_ACCESS_KEY, 'AWS_SECRET_ACCESS_KEY not set');
check('AWS_S3_BUCKET configured', process.env.AWS_S3_BUCKET, 'AWS_S3_BUCKET not set');
check('RAZORPAY_KEY_ID configured', process.env.RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID not set');
check('RAZORPAY_KEY_SECRET configured', process.env.RAZORPAY_KEY_SECRET, 'RAZORPAY_KEY_SECRET not set');
check('FRONTEND_URL configured', process.env.FRONTEND_URL, 'FRONTEND_URL not set (CORS will fail)');

// File structure
check('config/database.js exists', fs.existsSync(path.join(__dirname, '../config/database.js')), 'database.js not found');
check('config/socket.js exists', fs.existsSync(path.join(__dirname, '../config/socket.js')), 'socket.js not found');
check('middleware/auth.js exists', fs.existsSync(path.join(__dirname, '../middleware/auth.js')), 'auth.js not found');
check('models/User.js exists', fs.existsSync(path.join(__dirname, '../models/User.js')), 'User.js not found');
check('routes/auth.routes.js exists', fs.existsSync(path.join(__dirname, '../routes/auth.routes.js')), 'auth.routes.js not found');

// Dependencies
const packageJson = require('../package.json');
const requiredDeps = ['express', 'mongoose', 'jsonwebtoken', 'socket.io', '@aws-sdk/client-s3', 'razorpay'];
requiredDeps.forEach(dep => {
  check(`${dep} installed`, packageJson.dependencies[dep], `${dep} not in package.json`);
});

// Production checks
if (process.env.NODE_ENV === 'production') {
  check('Production: ENCRYPTION_KEY set', process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 32, 'ENCRYPTION_KEY not set for production');
  check('Production: ADMIN_EMAIL set', process.env.ADMIN_EMAIL, 'ADMIN_EMAIL not set for production');
  check('Production: SMTP_HOST set', process.env.SMTP_HOST, 'SMTP_HOST not set for production');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('⚠️  Some checks failed. Please fix the issues above before starting the server.\n');
  process.exit(1);
} else {
  console.log('✅ All checks passed! Ready to start the server.\n');
  process.exit(0);
}
