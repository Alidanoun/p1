const logger = require('../utils/logger');
const redis = require('../lib/redis');
const eventBus = require('../lib/eventBus');

const DEGRADATION_MODES = {
  NORMAL: 'NORMAL',
  SLOW_MODE: 'SLOW_MODE',           // Global throttling
  PARTIAL_MODE: 'PARTIAL_MODE',     // Auxiliary disabled
  READ_ONLY: 'READ_ONLY',           // Critical operations blocked (DB protection)
  EMERGENCY: 'EMERGENCY'            // Deep sleep / maintenance
};

/**
 * ⚖️ Autonomous Arbitrator Service
 * Acts as the "Consensus Judge" for the system.
 * Prevents feedback loops and ensures stability through multi-factor arbitration.
 */
class ArbitratorService {
  constructor() {
    this.currentMode = DEGRADATION_MODES.NORMAL;
    this.cooldowns = new Map();
  }

  /**
   * Arbitrates the next system mode based on multiple inputs.
   */
  async arbitrateMode(stabilityScore, governorShedding, hasCircuitOpen) {
    let targetMode = DEGRADATION_MODES.NORMAL;

    // 🧠 Arbitration Logic (Non-linear Consensus)
    if (stabilityScore < 20 || (stabilityScore < 40 && hasCircuitOpen)) {
      targetMode = DEGRADATION_MODES.EMERGENCY;
    } else if (stabilityScore < 50) {
      targetMode = DEGRADATION_MODES.READ_ONLY;
    } else if (stabilityScore < 75 || governorShedding) {
      targetMode = DEGRADATION_MODES.PARTIAL_MODE;
    } else if (stabilityScore < 90) {
      targetMode = DEGRADATION_MODES.SLOW_MODE;
    }

    // 🛡️ Safe Transition Guard: Cooldown & Hysteresis
    if (targetMode !== this.currentMode) {
      await this.transitionTo(targetMode);
    }

    return this.currentMode;
  }

  async transitionTo(newMode) {
    const prevMode = this.currentMode;
    
    // Recovery Gating: Prevent rapid flip-flopping
    const now = Date.now();
    const lastTransition = await redis.get('system:last_transition');
    if (lastTransition && (now - parseInt(lastTransition)) < 15000 && this._isUpgrading(prevMode, newMode)) {
      logger.info(`[Arbitrator] 🛡️ Transition deferred: Hysteresis protection active.`, { from: prevMode, to: newMode });
      return;
    }

    this.currentMode = newMode;
    logger.warn(`[Arbitrator] ⚖️ SYSTEM MODE TRANSITION: ${prevMode} -> ${newMode}`);

    await redis.pipeline()
      .set('system:mode', newMode)
      .set('system:last_transition', now.toString())
      .exec();

    eventBus.emitSafe('SYSTEM_MODE_CHANGED', { from: prevMode, to: newMode });
  }

  _isUpgrading(from, to) {
    const levels = Object.values(DEGRADATION_MODES);
    return levels.indexOf(from) > levels.indexOf(to); // Normal is index 0 (Top)
  }

  async getCurrentMode() {
    try {
      const mode = await redis.get('system:mode');
      return mode || this.currentMode;
    } catch (err) {
      return this.currentMode;
    }
  }
}

module.exports = new ArbitratorService();
module.exports.DEGRADATION_MODES = DEGRADATION_MODES;
