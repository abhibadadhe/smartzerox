// ============================================
// DATA ENCRYPTION UTILITIES
// ============================================

const crypto = require('crypto');

// Use AES-256-GCM for authenticated encryption
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;

// Derive encryption key from environment secret
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  return crypto.scryptSync(secret, 'salt', KEY_LENGTH);
}

/**
 * Encrypt sensitive data
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted data in format: iv:authTag:encryptedData
 */
exports.encrypt = (text) => {
  if (!text) return null;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypt encrypted data
 * @param {string} encryptedData - Encrypted data in format: iv:authTag:encryptedData
 * @returns {string} - Decrypted plain text
 */
exports.decrypt = (encryptedData) => {
  if (!encryptedData) return null;
  
  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed');
  }
};

/**
 * Hash sensitive data (one-way)
 * @param {string} data - Data to hash
 * @returns {string} - SHA-256 hash
 */
exports.hash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

/**
 * Generate secure random token
 * @param {number} length - Token length in bytes (default: 32)
 * @returns {string} - Random token in hex format
 */
exports.generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Mask sensitive data for display (e.g., phone numbers, emails)
 * @param {string} data - Data to mask
 * @param {string} type - Type of data ('email', 'phone', 'card')
 * @returns {string} - Masked data
 */
exports.maskSensitiveData = (data, type = 'default') => {
  if (!data) return '';
  
  switch (type) {
    case 'email':
      const [username, domain] = data.split('@');
      return `${username.slice(0, 2)}***@${domain}`;
    
    case 'phone':
      return `******${data.slice(-4)}`;
    
    case 'card':
      return `****-****-****-${data.slice(-4)}`;
    
    case 'default':
      return data.slice(0, 2) + '*'.repeat(data.length - 4) + data.slice(-2);
    
    default:
      return '***';
  }
};

/**
 * Encrypt object fields
 * @param {Object} obj - Object with fields to encrypt
 * @param {Array} fields - Array of field names to encrypt
 * @returns {Object} - Object with encrypted fields
 */
exports.encryptFields = (obj, fields) => {
  const encrypted = { ...obj };
  
  for (const field of fields) {
    if (encrypted[field]) {
      encrypted[field] = exports.encrypt(encrypted[field]);
    }
  }
  
  return encrypted;
};

/**
 * Decrypt object fields
 * @param {Object} obj - Object with encrypted fields
 * @param {Array} fields - Array of field names to decrypt
 * @returns {Object} - Object with decrypted fields
 */
exports.decryptFields = (obj, fields) => {
  const decrypted = { ...obj };
  
  for (const field of fields) {
    if (decrypted[field]) {
      try {
        decrypted[field] = exports.decrypt(decrypted[field]);
      } catch (error) {
        // If decryption fails, field might not be encrypted
        // Keep original value
      }
    }
  }
  
  return decrypted;
};

/**
 * Generate HMAC signature
 * @param {string} data - Data to sign
 * @param {string} secret - Secret key
 * @returns {string} - HMAC signature
 */
exports.generateHmac = (data, secret) => {
  return crypto
    .createHmac('sha256', secret || process.env.JWT_SECRET)
    .update(data)
    .digest('hex');
};

/**
 * Verify HMAC signature
 * @param {string} data - Original data
 * @param {string} signature - Signature to verify
 * @param {string} secret - Secret key
 * @returns {boolean} - True if signature is valid
 */
exports.verifyHmac = (data, signature, secret) => {
  const expectedSignature = exports.generateHmac(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Secure compare (timing-safe)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if strings match
 */
exports.secureCompare = (a, b) => {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(a),
    Buffer.from(b)
  );
};

module.exports = exports;
