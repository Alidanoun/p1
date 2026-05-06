/**
 * 🧠 System Control Plane (Active Governance Layer)
 */
class SystemControlPlane {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
  }

  async raiseAlert(type, metadata = {}) {
    this.logger.error(`[CONTROL-PLANE] 🚨 ALERT RAISED: ${type}`, metadata);
    const severity = this._classifySeverity(type);
    
    const incident = { type, severity, metadata, timestamp: new Date().toISOString() };
    await this.redis.lpush('system:incidents', JSON.stringify(incident));
    await this.redis.ltrim('system:incidents', 0, 99);

    if (severity === 'CRITICAL') {
      await this._activateKillSwitch(type, metadata);
    }
    return incident;
  }

  async _activateKillSwitch(reason, metadata) {
    this.logger.warn(`[CONTROL-PLANE] 🛑 KILL-SWITCH ACTIVATED.`, { reason });
    await this.redis.set('system:control_plane:kill_switch', JSON.stringify({
      active: true, reason, metadata, activatedAt: new Date().toISOString()
    }), 'EX', 3600 * 2);
  }

  async deactivateKillSwitch() {
    await this.redis.del('system:control_plane:kill_switch');
  }

  async getHealthStatus() {
    const killSwitch = await this.redis.get('system:control_plane:kill_switch');
    const incidents = await this.redis.lrange('system:incidents', 0, 5);
    return {
      status: killSwitch ? 'PROTECTED_MODE' : 'HEALTHY',
      killSwitch: killSwitch ? JSON.parse(killSwitch) : null,
      recentIncidents: incidents.map(i => JSON.parse(i)),
      timestamp: new Date()
    };
  }

  _classifySeverity(type) {
    if (['FINANCIAL_INTEGRITY_VIOLATION', 'LEDGER_DRIFT_CRITICAL'].includes(type)) return 'CRITICAL';
    if (['OUTBOX_JAM', 'STUCK_ORDERS_HIGH_COUNT'].includes(type)) return 'HIGH';
    return 'MEDIUM';
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'SystemControlPlane') return SystemControlPlane;
    const service = getContainer().systemControlPlane;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.SystemControlPlane = SystemControlPlane;
