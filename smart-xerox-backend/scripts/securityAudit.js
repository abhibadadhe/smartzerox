#!/usr/bin/env node

// ============================================
// SECURITY AUDIT SCRIPT
// ============================================
// Run this script to perform automated security checks

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🔒 Starting Security Audit...\n');

const issues = [];
const warnings = [];
const passed = [];

// ─── Check 1: Environment Variables ────────────────────────────────────────
function checkEnvironmentVariables() {
  console.log('📋 Checking environment variables...');
  
  const envPath = path.join(__dirname, '../.env');
  
  if (!fs.existsSync(envPath)) {
    issues.push('❌ .env file not found');
    return;
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  // Check for weak secrets
  const weakPatterns = [
    { pattern: /JWT_SECRET=.{0,31}$/, message: 'JWT_SECRET is too short (min 32 chars)' },
    { pattern: /JWT_SECRET=(secret|password|123|test)/i, message: 'JWT_SECRET is too weak' },
    { pattern: /ENCRYPTION_KEY=.{0,31}$/, message: 'ENCRYPTION_KEY is too short' },
    { pattern: /ADMIN_PASSWORD=(admin|password|123)/i, message: 'ADMIN_PASSWORD is too weak' },
  ];
  
  weakPatterns.forEach(({ pattern, message }) => {
    if (pattern.test(envContent)) {
      issues.push(`❌ ${message}`);
    }
  });
  
  // Check for required variables
  const required = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'MONGODB_URI',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
  ];
  
  required.forEach(key => {
    if (!envContent.includes(`${key}=`)) {
      issues.push(`❌ Missing required variable: ${key}`);
    }
  });
  
  passed.push('✅ Environment variables checked');
}

// ─── Check 2: Dependencies ─────────────────────────────────────────────────
function checkDependencies() {
  console.log('📦 Checking dependencies...');
  
  const packagePath = path.join(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  const securityPackages = [
    'helmet',
    'express-rate-limit',
    'express-mongo-sanitize',
    'xss-clean',
    'hpp',
    'bcryptjs',
    'jsonwebtoken',
  ];
  
  securityPackages.forEach(name => {
    if (!pkg.dependencies[name]) {
      issues.push(`❌ Missing security package: ${name}`);
    } else {
      passed.push(`✅ Security package installed: ${name}`);
    }
  });
}

// ─── Check 3: File Permissions ─────────────────────────────────────────────
function checkFilePermissions() {
  console.log('🔐 Checking file permissions...');
  
  const sensitiveFiles = [
    '../.env',
    '../config/database.js',
    '../config/razorpay.js',
  ];
  
  sensitiveFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const mode = (stats.mode & parseInt('777', 8)).toString(8);
      
      if (mode !== '600' && mode !== '644') {
        warnings.push(`⚠️  File ${file} has permissive permissions: ${mode}`);
      }
    }
  });
  
  passed.push('✅ File permissions checked');
}

// ─── Check 4: Hardcoded Secrets ────────────────────────────────────────────
function checkHardcodedSecrets() {
  console.log('🔍 Scanning for hardcoded secrets...');
  
  const secretPatterns = [
    /password\s*=\s*['"][^'"]{1,}['"]/gi,
    /api[_-]?key\s*=\s*['"][^'"]{1,}['"]/gi,
    /secret\s*=\s*['"][^'"]{1,}['"]/gi,
    /token\s*=\s*['"][^'"]{1,}['"]/gi,
  ];
  
  const scanDir = (dir) => {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        if (!file.includes('node_modules') && !file.includes('.git')) {
          scanDir(filePath);
        }
      } else if (file.endsWith('.js')) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        secretPatterns.forEach(pattern => {
          if (pattern.test(content)) {
            warnings.push(`⚠️  Potential hardcoded secret in ${filePath}`);
          }
        });
      }
    });
  };
  
  scanDir(path.join(__dirname, '..'));
  passed.push('✅ Hardcoded secrets scan completed');
}

// ─── Check 5: Security Headers ─────────────────────────────────────────────
function checkSecurityHeaders() {
  console.log('🛡️  Checking security headers configuration...');
  
  const serverPath = path.join(__dirname, '../server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const requiredHeaders = [
    { name: 'helmet', pattern: /helmet\(/ },
    { name: 'HSTS', pattern: /hsts:/ },
    { name: 'CSP', pattern: /contentSecurityPolicy:/ },
    { name: 'X-Frame-Options', pattern: /frameguard/ },
  ];
  
  requiredHeaders.forEach(({ name, pattern }) => {
    if (!pattern.test(serverContent)) {
      issues.push(`❌ Missing security header: ${name}`);
    } else {
      passed.push(`✅ Security header configured: ${name}`);
    }
  });
}

// ─── Check 6: Rate Limiting ────────────────────────────────────────────────
function checkRateLimiting() {
  console.log('⏱️  Checking rate limiting...');
  
  const serverPath = path.join(__dirname, '../server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  if (!serverContent.includes('rateLimit')) {
    issues.push('❌ Rate limiting not configured');
  } else {
    passed.push('✅ Rate limiting configured');
  }
}

// ─── Check 7: Input Validation ─────────────────────────────────────────────
function checkInputValidation() {
  console.log('✔️  Checking input validation...');
  
  const serverPath = path.join(__dirname, '../server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const validationMiddleware = [
    { name: 'mongoSanitize', pattern: /mongoSanitize/ },
    { name: 'xss-clean', pattern: /xss\(\)/ },
    { name: 'hpp', pattern: /hpp\(\)/ },
  ];
  
  validationMiddleware.forEach(({ name, pattern }) => {
    if (!pattern.test(serverContent)) {
      issues.push(`❌ Missing input validation: ${name}`);
    } else {
      passed.push(`✅ Input validation configured: ${name}`);
    }
  });
}

// ─── Check 8: HTTPS Configuration ──────────────────────────────────────────
function checkHTTPS() {
  console.log('🔒 Checking HTTPS configuration...');
  
  const envPath = path.join(__dirname, '../.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  if (envContent.includes('NODE_ENV=production')) {
    if (!envContent.includes('https://')) {
      warnings.push('⚠️  Production environment should use HTTPS');
    }
  }
  
  passed.push('✅ HTTPS configuration checked');
}

// ─── Check 9: Logging Configuration ────────────────────────────────────────
function checkLogging() {
  console.log('📝 Checking logging configuration...');
  
  const loggerPath = path.join(__dirname, '../config/logger.js');
  
  if (!fs.existsSync(loggerPath)) {
    warnings.push('⚠️  Logger configuration not found');
    return;
  }
  
  const loggerContent = fs.readFileSync(loggerPath, 'utf8');
  
  if (!loggerContent.includes('winston')) {
    warnings.push('⚠️  Winston logger not configured');
  } else {
    passed.push('✅ Logging configured');
  }
}

// ─── Check 10: Database Security ───────────────────────────────────────────
function checkDatabaseSecurity() {
  console.log('🗄️  Checking database security...');
  
  const dbPath = path.join(__dirname, '../config/database.js');
  const dbContent = fs.readFileSync(dbPath, 'utf8');
  
  if (!dbContent.includes('retryWrites')) {
    warnings.push('⚠️  Database retry writes not configured');
  }
  
  if (!dbContent.includes('w:')) {
    warnings.push('⚠️  Write concern not configured');
  }
  
  passed.push('✅ Database security checked');
}

// ─── Generate Security Score ───────────────────────────────────────────────
function calculateSecurityScore() {
  const total = passed.length + warnings.length + issues.length;
  const score = Math.round((passed.length / total) * 100);
  
  return score;
}

// ─── Run All Checks ────────────────────────────────────────────────────────
function runAudit() {
  try {
    checkEnvironmentVariables();
    checkDependencies();
    checkFilePermissions();
    checkHardcodedSecrets();
    checkSecurityHeaders();
    checkRateLimiting();
    checkInputValidation();
    checkHTTPS();
    checkLogging();
    checkDatabaseSecurity();
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 SECURITY AUDIT RESULTS');
    console.log('='.repeat(60) + '\n');
    
    if (passed.length > 0) {
      console.log('✅ PASSED CHECKS:');
      passed.forEach(p => console.log(`   ${p}`));
      console.log('');
    }
    
    if (warnings.length > 0) {
      console.log('⚠️  WARNINGS:');
      warnings.forEach(w => console.log(`   ${w}`));
      console.log('');
    }
    
    if (issues.length > 0) {
      console.log('❌ CRITICAL ISSUES:');
      issues.forEach(i => console.log(`   ${i}`));
      console.log('');
    }
    
    const score = calculateSecurityScore();
    console.log('='.repeat(60));
    console.log(`🎯 SECURITY SCORE: ${score}/100`);
    console.log('='.repeat(60) + '\n');
    
    if (score >= 90) {
      console.log('🎉 Excellent! Your application has strong security.');
    } else if (score >= 70) {
      console.log('👍 Good security, but there\'s room for improvement.');
    } else if (score >= 50) {
      console.log('⚠️  Fair security. Please address the issues above.');
    } else {
      console.log('🚨 Poor security! Immediate action required!');
    }
    
    console.log('\n💡 Tip: Run this audit regularly and before each deployment.\n');
    
    // Exit with error code if critical issues found
    if (issues.length > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Audit failed:', error.message);
    process.exit(1);
  }
}

// ─── Run Audit ─────────────────────────────────────────────────────────────
runAudit();
