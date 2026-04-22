const logger = require('../utils/logger');
const eventBus = require('../lib/eventBus');

/**
 * 📢 Alert Service
 * Dispatches critical notifications to External channels (Telegram, Email)
 * with robust Rate Limiting to prevent "Alert Storms".
 */
class AlertService {
  constructor() {
    this.cooldowns = new Map();
    this.ALERT_WINDOW = 120000; // ⏱️ 2 minutes cooldown per service/type
    
    // Subscribe to Event Bus signals
    this._initListeners();
  }

  _initListeners() {
    eventBus.on('SERVICE_DOWN_DB', (data) => this.sendCriticalAlert('Database', `ALERT: Database is down or unreachable. Error: ${data.error}`));
    eventBus.on('HEALTH_STATUS_CHANGED', (data) => {
      if (data.to === 'CRITICAL') {
        this.sendCriticalAlert('System', `EMERGENCY: System status moved to CRITICAL state (Health Score < 50)`);
      }
    });

    eventBus.on('CIRCUIT_OPENED', (data) => {
      this.sendWarningAlert('Circuit', `WARNING: Circuit Breaker OPENED for service: ${data.service}. Hard gate active.`);
    });
  }

  async sendCriticalAlert(service, message) {
    const coordinator = require('./globalCoordinator');
    const alertId = `critical_${service.toLowerCase()}`;

    await coordinator.coordinateAlert(alertId, async () => {
      logger.error(`[Alert] 🚨 CRITICAL DISPATCH: ${message}`);
      // Professional Integration: Telegram/Email logic goes here
      console.error(`\x1b[41m\x1b[37m [SYSTEM ALERT - ${service}] ${message} \x1b[0m`);
    });
  }

  async sendWarningAlert(service, message) {
    const coordinator = require('./globalCoordinator');
    const alertId = `warning_${service.toLowerCase()}`;

    await coordinator.coordinateAlert(alertId, async () => {
      logger.warn(`[Alert] 🟡 WARNING DISPATCH: ${message}`);
      console.warn(`\x1b[43m\x1b[30m [SYSTEM WARNING - ${service}] ${message} \x1b[0m`);
    });
  }

  _isCoolingDown(service, type) {
    const key = `${service}_${type}`;
    const lastSent = this.cooldowns.get(key);
    if (!lastSent) return false;
    
    const now = Date.now();
    return (now - lastSent) < this.ALERT_WINDOW;
  }

  _setCooldown(service, type) {
    const key = `${service}_${type}`;
    this.cooldowns.set(key, Date.now());
  }
}

module.exports = new AlertService();
