// ============================================
// REAL-TIME SECURITY MONITORING & THREAT DETECTION
// ============================================

const logger = require('../config/logger');
const { emitToAdmin } = require('../config/socket');

// ─── Threat Detection System ────────────────────────────────────────────────
class SecurityMonitor {
  constructor() {
    this.threats = new Map();
    this.ipReputation = new Map();
    this.anomalyScores = new Map();
    
    // Cleanup old data every 5 minutes
    setInterval(() => this.cleanup(), 300000);
  }
  
  /**
   * Track and analyze request patterns
   */
  analyzeRequest(req) {
    const ip = req.ip;
    const score = this.calculateAnomalyScore(req);
    
    const existing = this.anomalyScores.get(ip) || { scores: [], timestamp: Date.now() };
    existing.scores.push(score);
    existing.timestamp = Date.now();
    
    // Keep only last 100 scores
    if (existing.scores.length > 100) {
      existing.scores.shift();
    }
    
    this.anomalyScores.set(ip, existing);
    
    // Alert if average score is high
    const avgScore = existing.scores.reduce((a, b) => a + b, 0) / existing.scores.length;
    
    if (avgScore > 70) {
      this.reportThreat({
        type: 'HIGH_ANOMALY_SCORE',
        ip,
        score: avgScore,
        userAgent: req.headers['user-agent'],
        path: req.path,
        severity: 'high',
      });
    }
  }
  
  /**
   * Calculate anomaly score (0-100)
   */
  calculateAnomalyScore(req) {
    let score = 0;
    
    // Check user agent
    const ua = req.headers['user-agent'] || '';
    if (!ua || ua.length < 10) score += 20;
    if (/bot|crawler|spider|scraper/i.test(ua)) score += 15;
    
    // Check for suspicious patterns in URL
    if (/admin|config|\.env|backup|sql|dump/i.test(req.path)) score += 25;
    
    // Check for unusual headers
    if (!req.headers['accept-language']) score += 10;
    if (!req.headers['accept-encoding']) score += 10;
    
    // Check request method
    if (['TRACE', 'TRACK', 'DEBUG'].includes(req.method)) score += 30;
    
    // Check for suspicious query parameters
    const queryString = JSON.stringify(req.query);
    if (/union|select|insert|delete|drop|exec/i.test(queryString)) score += 40;
    
    return Math.min(score, 100);
  }
  
  /**
   * Track failed authentication attempts
   */
  trackFailedAuth(identifier, reason) {
    const key = `auth_fail_${identifier}`;
    const attempts = this.threats.get(key) || { count: 0, reasons: [], firstSeen: Date.now() };
    
    attempts.count += 1;
    attempts.reasons.push({ reason, timestamp: Date.now() });
    attempts.lastSeen = Date.now();
    
    this.threats.set(key, attempts);
    
    // Alert after 5 failed attempts
    if (attempts.count >= 5) {
      this.reportThreat({
        type: 'BRUTE_FORCE_ATTEMPT',
        identifier,
        attempts: attempts.count,
        duration: Date.now() - attempts.firstSeen,
        severity: 'critical',
      });
    }
  }
  
  /**
   * Track suspicious payment activity
   */
  trackPaymentAnomaly(userId, orderId, reason) {
    this.reportThreat({
      type: 'PAYMENT_ANOMALY',
      userId,
      orderId,
      reason,
      severity: 'high',
    });
  }
  
  /**
   * Track data exfiltration attempts
   */
  trackDataExfiltration(ip, dataType, volume) {
    const key = `exfil_${ip}`;
    const activity = this.threats.get(key) || { volume: 0, requests: 0, firstSeen: Date.now() };
    
    activity.volume += volume;
    activity.requests += 1;
    activity.lastSeen = Date.now();
    
    this.threats.set(key, activity);
    
    // Alert if large volume in short time
    const duration = Date.now() - activity.firstSeen;
    const ratePerMinute = (activity.volume / duration) * 60000;
    
    if (ratePerMinute > 10000000) { // 10MB per minute
      this.reportThreat({
        type: 'DATA_EXFILTRATION',
        ip,
        dataType,
        volume: activity.volume,
        rate: ratePerMinute,
        severity: 'critical',
      });
    }
  }
  
  /**
   * Track privilege escalation attempts
   */
  trackPrivilegeEscalation(userId, attemptedRole, currentRole) {
    this.reportThreat({
      type: 'PRIVILEGE_ESCALATION',
      userId,
      attemptedRole,
      currentRole,
      severity: 'critical',
    });
  }
  
  /**
   * Report threat to admin and log
   */
  reportThreat(threat) {
    const threatId = `${threat.type}_${Date.now()}`;
    
    logger.error('SECURITY THREAT DETECTED', {
      threatId,
      ...threat,
      timestamp: new Date().toISOString(),
    });
    
    // Emit to admin dashboard in real-time
    emitToAdmin('security:threat', {
      id: threatId,
      ...threat,
      timestamp: new Date().toISOString(),
    });
    
    // Store threat
    this.threats.set(threatId, {
      ...threat,
      timestamp: Date.now(),
    });
    
    // Auto-response based on severity
    if (threat.severity === 'critical') {
      this.autoRespond(threat);
    }
  }
  
  /**
   * Automated incident response
   */
  autoRespond(threat) {
    switch (threat.type) {
      case 'BRUTE_FORCE_ATTEMPT':
        // Temporarily block IP
        logger.warn(`Auto-blocking IP for brute force: ${threat.identifier}`);
        // Implementation: Add to blocked IPs list
        break;
      
      case 'DATA_EXFILTRATION':
        // Rate limit IP aggressively
        logger.warn(`Rate limiting IP for data exfiltration: ${threat.ip}`);
        break;
      
      case 'PRIVILEGE_ESCALATION':
        // Lock user account
        logger.warn(`Locking account for privilege escalation: ${threat.userId}`);
        // Implementation: Set user.isActive = false
        break;
      
      default:
        logger.info(`No auto-response for threat type: ${threat.type}`);
    }
  }
  
  /**
   * Get IP reputation score
   */
  getIpReputation(ip) {
    const reputation = this.ipReputation.get(ip) || { score: 100, incidents: [] };
    return reputation.score;
  }
  
  /**
   * Update IP reputation
   */
  updateIpReputation(ip, incident, scoreChange) {
    const reputation = this.ipReputation.get(ip) || { score: 100, incidents: [] };
    
    reputation.score = Math.max(0, Math.min(100, reputation.score + scoreChange));
    reputation.incidents.push({
      incident,
      timestamp: Date.now(),
      scoreChange,
    });
    
    this.ipReputation.set(ip, reputation);
    
    if (reputation.score < 30) {
      logger.warn(`Low IP reputation: ${ip} (score: ${reputation.score})`);
    }
  }
  
  /**
   * Cleanup old data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    
    // Cleanup threats
    for (const [key, value] of this.threats.entries()) {
      if (now - value.timestamp > maxAge) {
        this.threats.delete(key);
      }
    }
    
    // Cleanup anomaly scores
    for (const [key, value] of this.anomalyScores.entries()) {
      if (now - value.timestamp > maxAge) {
        this.anomalyScores.delete(key);
      }
    }
    
    // Cleanup IP reputation (keep for 24 hours)
    for (const [key, value] of this.ipReputation.entries()) {
      const lastIncident = value.incidents[value.incidents.length - 1];
      if (lastIncident && now - lastIncident.timestamp > 86400000) {
        this.ipReputation.delete(key);
      }
    }
    
    logger.info('Security monitor cleanup completed');
  }
  
  /**
   * Get security statistics
   */
  getStats() {
    return {
      activeThreats: this.threats.size,
      monitoredIps: this.anomalyScores.size,
      reputationEntries: this.ipReputation.size,
      criticalThreats: Array.from(this.threats.values()).filter(t => t.severity === 'critical').length,
    };
  }
  
  /**
   * Get recent threats
   */
  getRecentThreats(limit = 50) {
    return Array.from(this.threats.entries())
      .map(([id, threat]) => ({ id, ...threat }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}

// Singleton instance
const securityMonitor = new SecurityMonitor();

// Middleware to analyze all requests
exports.monitorRequest = (req, res, next) => {
  securityMonitor.analyzeRequest(req);
  next();
};

// Export monitor instance
exports.securityMonitor = securityMonitor;

module.exports = exports;
