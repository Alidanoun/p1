/**
 * 🧠 System Control Plane (Active Governance Layer)
 * Monitors system health signals and executes automatic safety responses (Kill-switches, Isolation).
 */

const redis = require('../lib/redis');
const logger = require('../utils/logger');

const SYSTEM_STATUS_KEY = 'system:control_plane:status';
const KILL_SWITCH_KEY = 'system:control_plane:kill_switch';

class SystemControlPlane {
  /**
   * 🚨 Raise System Alert
   * Triggers classification and automatic response.
   */
  async raiseAlert(type, metadata = {}) {
    logger.error(`[CONTROL-PLANE] 🚨 ALERT RAISED: ${type}`, metadata);

    const severity = this._classifySeverity(type);
    
    // 1. Log the incident in Redis for tracking
    const incident = {
      type,
      severity,
      metadata,
      timestamp: new Date().toISOString()
    };
    await redis.lpush('system:incidents', JSON.stringify(incident));
    await redis.ltrim('system:incidents', 0, 99); // Keep last 100

    // 2. Automatic Response Logic
    if (severity === 'CRITICAL') {
      await this._activateKillSwitch(type, metadata);
    }

    return incident;
  }

  /**
   * 🛡️ Activate Kill-Switch
   * Pauses all write operations in the Contract Gateway.
   */
  async _activateKillSwitch(reason, metadata) {
    logger.warn(`[CONTROL-PLANE] 🛑 CRITICAL FAILURE DETECTED. ACTIVATING GLOBAL KILL-SWITCH.`, { reason });
    
    await redis.set(KILL_SWITCH_KEY, JSON.stringify({
      active: true,
      reason,
      metadata,
      activatedAt: new Date().toISOString()
    }), 'EX', 3600 * 2); // Auto-expire after 2 hours (safety)
    
    // TODO: Send urgent notification to developers (SMS/Slack/Telegram)
  }

  /**
   * 🔓 Deactivate Kill-Switch (Manual override usually)
   */
  async deactivateKillSwitch() {
    await redis.del(KILL_SWITCH_KEY);
    logger.info(`[CONTROL-PLANE] ✅ Global Kill-Switch deactivated.`);
  }

  /**
   * 🔍 Get Current System Health Status
   */
  async getHealthStatus() {
    const killSwitch = await redis.get(KILL_SWITCH_KEY);
    const incidents = await redis.lrange('system:incidents', 0, 5);
    
    return {
      status: killSwitch ? 'PROTECTED_MODE' : 'HEALTHY',
      killSwitch: killSwitch ? JSON.parse(killSwitch) : null,
      recentIncidents: incidents.map(i => JSON.parse(i)),
      timestamp: new Date()
    };
  }

  _classifySeverity(type) {
    const criticalTypes = [
      'FINANCIAL_INTEGRITY_VIOLATION',
      'LEDGER_DRIFT_CRITICAL',
      'DATABASE_CORRUPTION_SUSPECTED'
    ];
    
    const highTypes = [
      'OUTBOX_JAM',
      'STUCK_ORDERS_HIGH_COUNT',
      'REDIS_LOCK_TIMEOUT_STORM'
    ];

    if (criticalTypes.includes(type)) return 'CRITICAL';
    if (highTypes.includes(type)) return 'HIGH';
    return 'MEDIUM';
  }
}

module.exports = new SystemControlPlane();
