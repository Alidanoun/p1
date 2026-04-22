const observability = require('./observabilityService');
const arbitrator = require('./arbitratorService');
const { DEGRADATION_MODES } = require('./arbitratorService');
const logger = require('../utils/logger');
const redis = require('../lib/redis');

/**
 * 🚦 System Load Governor
 * Implements "Load Shedding" to protect the system under stress.
 * Drops Auxiliary services first, then Business Essential, 
 * to save Mission Critical operations.
 */
class GovernorService {
  constructor() {
    this.PRIORITIES = {
      MISSION_CRITICAL: 1, // Orders, Auth
      BUSINESS_ESSENTIAL: 2, // Items, Cart
      AUXILIARY: 3          // Reviews, Analytics, Stats
    };
  }

  async shouldShed(priority = this.PRIORITIES.MISSION_CRITICAL) {
    const health = await observability.getLiveStatus();
    const mode = await arbitrator.getCurrentMode();
    const { score, errorBudgetRemaining, business } = health;
    const p95 = business?.p95 || 0;

    // 🛡️ High-Level Mode Gating
    if (mode === DEGRADATION_MODES.EMERGENCY) return true;

    // 🏆 Tiered Adaptive Shedding (Big Tech Logic)
    
    // Tier 3: AUXILIARY (Analytics, Reviews)
    if (priority === this.PRIORITIES.AUXILIARY) {
      if (score < 80 || errorBudgetRemaining < 800 || p95 > 300) return true;
    }

    // Tier 2: BUSINESS_ESSENTIAL (Menu, Cart)
    if (priority === this.PRIORITIES.BUSINESS_ESSENTIAL) {
      if (score < 60 || errorBudgetRemaining < 400 || p95 > 800) return true;
    }

    // Tier 1: MISSION_CRITICAL (Orders, Auth)
    // Only shed if score is below absolute basement or emergency mode
    if (priority === this.PRIORITIES.MISSION_CRITICAL) {
      if (score < 30 || errorBudgetRemaining < 100) return true;
    }

    // 🚀 Global RPS Limit (Hard Cap)
    const rps = await this.getCurrentRPS();
    if (rps > 500) { // Increased from 150 for Scale Readiness
      logger.warn(`[Governor] 🚨 Hard RPS Cap Breached: ${rps} RPS. Throttling all non-critical.`);
      if (priority > this.PRIORITIES.MISSION_CRITICAL) return true;
    }

    return false;
  }

  async getCurrentRPS() {
    try {
      const currentSec = Math.floor(Date.now() / 1000);
      const count = await redis.get(`stats:rps:${currentSec}`);
      return parseInt(count || '0');
    } catch (err) {
      return 0;
    }
  }

  async trackRequest() {
    try {
      const currentSec = Math.floor(Date.now() / 1000);
      const redisKey = `stats:rps:${currentSec}`;
      await redis.pipeline()
        .incr(redisKey)
        .expire(redisKey, 10)
        .exec();
    } catch (err) {}
  }
}

module.exports = new GovernorService();
