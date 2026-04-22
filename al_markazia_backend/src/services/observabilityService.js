const logger = require('../utils/logger');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const { toNumber } = require('../utils/number');
const eventBus = require('../lib/eventBus');
const circuitBreaker = require('./circuitBreakerService');

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
  'socket': ['db'], // Socket depends on DB for some events
  'fcm': ['db'],    // FCM might depend on DB for token lookup
  // Add other dependencies as needed
};

/**
 * 🛰️ Global Observability Service
 * Normalizes system health using criticality levels, calculates scores,
 * and maintains the high-level State Machine.
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
    
    // SLO Config (Big Tech Level 9)
    this.SLO = {
      SUCCESS_RATE: 99.0, // %
      P95_LATENCY: 300,   // ms
      ERROR_RATE: 0.5,    // %
      ERROR_BUDGET_HOURS: 24
    };
  }

  /**
   * Exponential Risk Scoring
   * Penalizes metrics more heavily as they approach critical thresholds.
   */
  _calculateScore(value, threshold, weight) {
    const ratio = Math.min(value / threshold, 2); 
    // Exponential growth of penalty: score * (1 - e^ratio)
    const penalty = weight * (Math.pow(2, ratio) - 1);
    return Math.max(0, penalty);
  }

  /**
   * Normalizes health status across services.
   * Logic: If a CRITICAL service (DB) is down, the whole system drops to CRITICAL/DEGRADED.
   */
  calculateHealthState(results) {
    let score = 100;
    let status = SYSTEM_STATES.HEALTHY;
    const services = {};
    const latencies = {};

    // 1. Identify "Root Failures" first
    const failingRootNames = results
      .filter(r => !r.ok && !DEPENDENCY_MAP[r.name])
      .map(r => r.name);

    results.forEach(res => {
      const { name, ok, latency, error } = res;
      
      // Update EMA Latency
      const prevLat = this.currentMetrics.latencies[name] || latency;
      const smoothedLat = Math.round(prevLat * (1 - this.emaSmoothing) + latency * this.emaSmoothing);
      latencies[name] = smoothedLat;

      services[name] = ok ? 'ok' : 'down';

      if (!ok) {
        // Dependency Guard: Is this a "Cascade" failure?
        const roots = DEPENDENCY_MAP[name] || [];
        const isCascade = roots.some(r => failingRootNames.includes(r));

        if (isCascade) {
          services[name] = 'blocked';
          logger.debug(`[Observability] Service ${name} marked as BLOCKED due to root dependency failure.`);
        } else {
          // Actual Failure: Penalize and trigger Circuit Breaker
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
    const nextState = this.calculateHealthState(results);
    const prevState = { ...this.currentMetrics };
    // 4. Load Metrics (RPS & Queues)
    const governor = require('./governorService');
    const arbitrator = require('./arbitratorService');
    const { orderQueue } = require('../queues/orderQueue');
    
    try {
      const rps = await governor.getCurrentRPS();
      const queueSize = await orderQueue.count();
      nextState.load = { rps, queueSize };

      // 🧠 Pre-failure Detection (Slope Analysis)
      const prevLoad = prevState.load || { rps: 0, queueSize: 0 };
      const queueGrowth = queueSize - prevLoad.queueSize;
      if (queueGrowth > 5) {
        logger.warn(`[Observability] 🌋 Rapid Queue Growth Detected: Slope=${queueGrowth}. Pre-failure alert.`);
        nextState.score -= 15; // Manual penalty for instability
      }

      // ⚖️ Consensus Arbitration
      const hasCircuitOpen = results.some(r => !r.ok);
      await arbitrator.arbitrateMode(nextState.score, nextState.score < 80, hasCircuitOpen);

      // 🛒 Business Metrics SLO (Level 9 - Big Tech)
      await this.updateBusinessSLOs(nextState);

    } catch (err) {
      logger.error('[Observability] Runtime metrics failed', { error: err.message });
    }

    this.currentMetrics = nextState;

    // 1. Persistence (Redis for Live State)
    try {
      await redis.set('system:health:current', JSON.stringify(nextState));
    } catch (err) {
      logger.error('[Observability] Redis update failed', { error: err.message });
    }

    // 2. Logging & Audit (Prisma for History)
    if (nextState.status !== prevState.status || Math.abs(nextState.score - prevState.score) > 10) {
      await this.logHealthMetric(nextState);
    }

    // 3. Decoupled Signaling
    if (nextState.status !== prevState.status) {
      eventBus.emitSafe('HEALTH_STATUS_CHANGED', { from: prevState.status, to: nextState.status });
    }

    // Explicit Service Down Events
    results.forEach(res => {
      if (!res.ok) {
        eventBus.emitSafe(`SERVICE_DOWN_${res.name.toUpperCase()}`, { error: res.error });
      }
    });

    return nextState;
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
      logger.error('[Observability] DB persistent log failed', { error: err.message });
    }
  }

  /**
   * 🛒 Business SLO Engine
   * Analyzes order success/cancellation rates and latency to detect UX degradation.
   */
  async updateBusinessSLOs(nextState) {
    try {
      const oneHourAgo = new Date(Date.now() - 3600000);
      const [orders, errorCount] = await Promise.all([
        prisma.order.groupBy({
          by: ['status'],
          where: { createdAt: { gte: oneHourAgo } },
          _count: true
        }),
        // Track non-business errors (5xx)
        redis.get('stats:errors:1h')
      ]);

      const stats = orders.reduce((acc, curr) => {
        acc[curr.status] = curr._count;
        return acc;
      }, {});

      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      const cancelled = stats['cancelled'] || 0;
      const successRate = total > 0 ? ((total - cancelled) / total) * 100 : 100;
      const errorRate = total > 0 ? (parseInt(errorCount || '0') / total) * 100 : 0;

      // P95 Latency Aggregate (From EMA system)
      const p95 = Math.max(...Object.values(nextState.latencies));

      nextState.business = { 
        totalOrders: total, 
        successRate, 
        errorRate,
        p95 
      };
      
      // 📊 Error Budget Tracking (Persistent Consumption)
      await this._consumeErrorBudget(nextState);

      // Penalty for SLO Breach (Exponential)
      if (successRate < this.SLO.SUCCESS_RATE) {
        const diff = this.SLO.SUCCESS_RATE - successRate;
        nextState.score -= Math.round(Math.pow(diff, 1.5) * 5);
      }

      if (p95 > this.SLO.P95_LATENCY) {
        const ratio = p95 / this.SLO.P95_LATENCY;
        nextState.score -= Math.round(Math.pow(ratio, 2) * 10);
      }

      nextState.score = Math.max(0, nextState.score);

      // 🧠 Big Tech Decision Intelligence
      const intelligence = require('./intelligenceEngine');
      await intelligence.orchestrate(nextState);

    } catch (err) {
      logger.error('[Observability] Business SLO calculation failed', { error: err.message });
    }
  }

  /**
   * 🛡️ Error Budget Consumer
   * Tracks cumulative failure over time and persists in Redis.
   */
  async _consumeErrorBudget(state) {
    const budgetKey = 'system:error_budget:remaining';
    let budget = 1000; // Start with 1000 "Reliability Units"
    
    const cached = await redis.get(budgetKey);
    if (cached) budget = toNumber(cached, 1000);

    // Cost of unreliability
    let cost = 0;
    if (state.business.successRate < 99) cost += 5;
    if (state.business.p95 > 500) cost += 10;
    if (state.status === SYSTEM_STATES.CRITICAL) cost += 50;

    budget = Math.max(0, budget - cost);
    
    // Regeneration (slowly add 2 units per check if healthy)
    if (state.status === SYSTEM_STATES.HEALTHY && budget < 1000) {
      budget += 2;
    }

    state.errorBudgetRemaining = budget;
    await redis.set(budgetKey, budget.toFixed(2), 'EX', 86400 * 7);

    if (budget < 200) {
      logger.error('[Observability] 🚨 ERROR BUDGET EXHAUSTED. Forced Safety Mode.');
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
