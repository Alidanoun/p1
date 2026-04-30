const logger = require('../utils/logger');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const { toNumber } = require('../utils/number');

const SYSTEM_STATES = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  CRITICAL: 'CRITICAL'
};

const CRITICALITY = {
  DB: 'db',
  REDIS: 'redis',
  SOCKET: 'socket',
  FCM: 'fcm'
};

const DEPENDENCY_MAP = {
  'socket': ['db'],
  'fcm': ['db'],
};

/**
 * 🛰️ Global Observability Service
 */
class ObservabilityService {
  constructor() {
    this.currentMetrics = {
      score: 100,
      status: SYSTEM_STATES.HEALTHY,
      services: {},
      latencies: {},
      load: { rps: 0, queueSize: 0 }
    };
    this.emaSmoothing = 0.3; 
    this.history = []; 
    this.isUpdating = false; // 🛡️ Recursion Guard

    this.SLO = {
      SUCCESS_RATE: 99.0,
      P95_LATENCY: 300,
      ERROR_RATE: 0.5,
      ERROR_BUDGET_HOURS: 24
    };
  }

  calculateHealthState(results) {
    const circuitBreaker = require('./circuitBreakerService');
    let score = 100;
    let status = SYSTEM_STATES.HEALTHY;
    const services = {};
    const latencies = {};

    const failingRootNames = results
      .filter(r => !r.ok && !DEPENDENCY_MAP[r.name])
      .map(r => r.name);

    results.forEach(res => {
      const { name, ok, latency } = res;
      const prevLat = this.currentMetrics.latencies[name] || latency;
      const smoothedLat = Math.round(prevLat * (1 - this.emaSmoothing) + latency * this.emaSmoothing);
      latencies[name] = smoothedLat;

      services[name] = ok ? 'ok' : 'down';

      if (!ok) {
        const roots = DEPENDENCY_MAP[name] || [];
        const isCascade = roots.some(r => failingRootNames.includes(r));

        if (isCascade) {
          services[name] = 'blocked';
        } else {
          if (name === CRITICALITY.DB) score -= 50;
          else if (name === CRITICALITY.REDIS) score -= 20;
          else score -= 10;
          
          circuitBreaker.recordFailure(name);
        }
      } else {
        circuitBreaker.recordSuccess(name);
      }
    });

    score = Math.max(0, score);
    if (score < 50) status = SYSTEM_STATES.CRITICAL;
    else if (score < 90) status = SYSTEM_STATES.DEGRADED;

    return { score, status, services, latencies };
  }

  async updateHealth(results) {
    if (this.isUpdating) return this.currentMetrics;
    this.isUpdating = true;

    try {
      const nextState = this.calculateHealthState(results);
      const prevState = { ...this.currentMetrics };
      
      const governor = require('./governorService');
      const arbitrator = require('./arbitratorService');
      const { orderQueue } = require('../queues/orderQueue');
      const eventBus = require('../lib/eventBus');

      const rps = await governor.getCurrentRPS();
      const queueSize = await orderQueue.count();
      nextState.load = { rps, queueSize };

      const prevLoad = prevState.load || { rps: 0, queueSize: 0 };
      const queueGrowth = queueSize - prevLoad.queueSize;
      if (queueGrowth > 5) {
        logger.warn(`[Observability] 🌋 Rapid Queue Growth Detected: Slope=${queueGrowth}.`);
        nextState.score -= 15;
      }

      const hasCircuitOpen = results.some(r => !r.ok);
      await arbitrator.arbitrateMode(nextState.score, nextState.score < 80, hasCircuitOpen);

      await this.updateBusinessSLOs(nextState);

      this.currentMetrics = nextState;

      await redis.set('system:health:current', JSON.stringify(nextState));

      if (nextState.status !== prevState.status || Math.abs(nextState.score - prevState.score) > 10) {
        await this.logHealthMetric(nextState);
      }

      if (nextState.status !== prevState.status) {
        eventBus.emitSafe('HEALTH_STATUS_CHANGED', { from: prevState.status, to: nextState.status });
      }

      results.forEach(res => {
        if (!res.ok) {
          eventBus.emitSafe(`SERVICE_DOWN_${res.name.toUpperCase()}`, { error: res.error });
        }
      });

      return nextState;
    } catch (err) {
      logger.error('[Observability] Update failed', { error: err.message });
      return this.currentMetrics;
    } finally {
      this.isUpdating = false;
    }
  }

  async logHealthMetric(data) {
    try {
      await prisma.healthMetric.create({
        data: {
          score: data.score,
          status: data.status,
          services: data.services,
          latencies: data.latencies
        }
      });
    } catch (err) {
      logger.error('[Observability] Persistence failed', { error: err.message });
    }
  }

  async updateBusinessSLOs(nextState) {
    try {
      const oneHourAgo = new Date(Date.now() - 3600000);
      const [orders, errorCount] = await Promise.all([
        prisma.order.groupBy({
          by: ['status'],
          where: { createdAt: { gte: oneHourAgo } },
          _count: true
        }),
        redis.get('stats:errors:1h')
      ]);

      const stats = orders.reduce((acc, curr) => {
        acc[curr.status] = curr._count;
        return acc;
      }, {});

      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      const cancelled = stats['cancelled'] || 0;
      const successRate = total > 0 ? ((total - cancelled) / total) * 100 : 100;

      const p95 = Math.max(...Object.values(nextState.latencies), 0);

      nextState.business = { totalOrders: total, successRate, p95 };
      
      await this._consumeErrorBudget(nextState);

      if (successRate < this.SLO.SUCCESS_RATE) {
        const diff = this.SLO.SUCCESS_RATE - successRate;
        nextState.score -= Math.round(Math.pow(diff, 1.5) * 5);
      }

      if (p95 > this.SLO.P95_LATENCY) {
        const ratio = p95 / this.SLO.P95_LATENCY;
        nextState.score -= Math.round(Math.pow(ratio, 2) * 10);
      }

      nextState.score = Math.max(0, nextState.score);

      const intelligence = require('./intelligenceEngine');
      await intelligence.orchestrate(nextState);

    } catch (err) {
      logger.error('[Observability] SLO analysis failed', { error: err.message });
    }
  }

  async _consumeErrorBudget(state) {
    const budgetKey = 'system:error_budget:remaining';
    let budget = 1000;
    
    const cached = await redis.get(budgetKey);
    if (cached) budget = toNumber(cached, 1000);

    let cost = 0;
    if (state.business.successRate < 99) cost += 5;
    if (state.business.p95 > 500) cost += 10;
    if (state.status === SYSTEM_STATES.CRITICAL) cost += 50;

    budget = Math.max(0, budget - cost);
    
    if (state.status === SYSTEM_STATES.HEALTHY && budget < 1000) {
      budget += 2;
    }

    state.errorBudgetRemaining = budget;
    await redis.set(budgetKey, budget.toFixed(2), 'EX', 86400 * 7);

    if (budget < 200) {
      logger.error('[Observability] 🚨 ERROR BUDGET EXHAUSTED.');
    }
  }

  async getLiveStatus() {
    try {
      const cached = await redis.get('system:health:current');
      return cached ? JSON.parse(cached) : this.currentMetrics;
    } catch (err) {
      return this.currentMetrics;
    }
  }
}

module.exports = new ObservabilityService();
