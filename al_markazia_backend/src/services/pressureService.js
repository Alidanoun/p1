const logger = require('../utils/logger');

/**
 * 🌡️ Pressure Controller (SDS 3.0)
 * Monitors Event Loop Lag and manages system degradation states.
 * Uses Hysteresis to prevent state flapping.
 */

const MODES = {
  NORMAL: 'NORMAL',     // Optimal performance
  HIGH_LOAD: 'HIGH_LOAD', // Enable Coalescing & Batching
  DEGRADED: 'DEGRADED',   // Drop BEST_EFFORT events
  SURVIVAL: 'SURVIVAL'    // Only GUARANTEED events
};

class PressureService {
  constructor() {
    this.currentMode = MODES.NORMAL;
    this.eventLoopLag = 0;
    this.thresholds = {
      HIGH_LOAD: { enter: 150, exit: 70 },  // ms lag
      DEGRADED: { enter: 350, exit: 200 },
      SURVIVAL: { enter: 700, exit: 500 }
    };
    
    this.metrics = {
      droppedEvents: 0,
      modeTransitions: 0,
      maxLag: 0
    };
  }

  startMonitoring() {
    let lastTime = Date.now();
    
    setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - lastTime - 1000); // We expect 1000ms interval
      this.eventLoopLag = lag;
      if (lag > this.metrics.maxLag) this.metrics.maxLag = lag;
      
      this._recalculateMode();
      lastTime = now;
    }, 1000);

    logger.info('🌡️ [PressureService] SDS 3.0 Adaptive Monitoring started');
  }

  _recalculateMode() {
    const lag = this.eventLoopLag;
    const oldMode = this.currentMode;

    // Survival logic
    if (lag > this.thresholds.SURVIVAL.enter) this.currentMode = MODES.SURVIVAL;
    else if (this.currentMode === MODES.SURVIVAL && lag < this.thresholds.SURVIVAL.exit) this.currentMode = MODES.DEGRADED;
    
    // Degraded logic
    else if (lag > this.thresholds.DEGRADED.enter) this.currentMode = MODES.DEGRADED;
    else if (this.currentMode === MODES.DEGRADED && lag < this.thresholds.DEGRADED.exit) this.currentMode = MODES.HIGH_LOAD;
    
    // High Load logic
    else if (lag > this.thresholds.HIGH_LOAD.enter) this.currentMode = MODES.HIGH_LOAD;
    else if (this.currentMode === MODES.HIGH_LOAD && lag < this.thresholds.HIGH_LOAD.exit) this.currentMode = MODES.NORMAL;

    if (oldMode !== this.currentMode) {
      this.metrics.modeTransitions++;
      logger.warn(`🌡️ [PressureService] Mode changed: ${oldMode} -> ${this.currentMode}`, { lag });
    }
  }

  shouldDrop(intent) {
    const { INTENTS } = require('../shared/eventGovernance');
    
    if (intent === INTENTS.GUARANTEED) return false;
    
    if (this.currentMode === MODES.SURVIVAL) return true; // Drop everything but guaranteed
    if (this.currentMode === MODES.DEGRADED && intent === INTENTS.BEST_EFFORT) {
      this.metrics.droppedEvents++;
      return true;
    }
    
    return false;
  }

  isCoalescingRequired() {
    return this.currentMode !== MODES.NORMAL;
  }

  getMetrics() {
    return { ...this.metrics, currentMode: this.currentMode, currentLag: this.eventLoopLag };
  }
}

module.exports = new PressureService();
