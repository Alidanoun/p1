const prisma = require('./prisma');
const redis = require('./redis');
const logger = require('../utils/logger');

/**
 * 📦 Service Container (v6 - Clean & Stable)
 */

const container = {
  prisma,
  redis,
  logger
};

const factories = {
  securityPolicyService: () => {
    const { SecurityPolicyService } = require('../services/securityPolicyService');
    return new SecurityPolicyService(container);
  },
  loyaltyService: () => {
    const { LoyaltyService } = require('../services/loyaltyService');
    return new LoyaltyService(container);
  },
  financialService: () => {
    const { FinancialService } = require('../services/financialService');
    return new FinancialService(container);
  },
  auditService: () => {
    const { AuditService } = require('../services/auditService');
    return new AuditService(container);
  },
  notificationService: () => {
    const { NotificationService } = require('../services/notificationService');
    const instance = new NotificationService(container);
    instance.init();
    return instance;
  },
  outboxService: () => {
    const { OutboxService } = require('../services/outboxService');
    return new OutboxService(container);
  },
  featureFlagsService: () => {
    const { FeatureFlagsService } = require('../services/featureFlagsService');
    return new FeatureFlagsService(container);
  },
  analyticsService: () => {
    const { AnalyticsService } = require('../services/analyticsService');
    return new AnalyticsService(container);
  },
  orderService: () => {
    const { OrderService } = require('../services/orderService');
    return new OrderService(container);
  },
  contractGateway: () => {
    const { ContractGateway } = require('../services/contractGateway');
    return new ContractGateway(container);
  },
  systemControlPlane: () => {
    const { SystemControlPlane } = require('../services/systemControlPlane');
    return new SystemControlPlane(container);
  },
  idempotencyService: () => {
    const { IdempotencyService } = require('../services/idempotencyService');
    return new IdempotencyService(container);
  },
  circuitBreakerService: () => {
    const { CircuitBreakerService } = require('../services/circuitBreakerService');
    return new CircuitBreakerService(container);
  },
  orderModificationOrchestrator: () => {
    const { OrderModificationOrchestrator } = require('../services/orderModificationOrchestrator');
    return new OrderModificationOrchestrator(container);
  }
};

const instances = {};

Object.keys(factories).forEach(name => {
  Object.defineProperty(container, name, {
    get: () => {
      if (!instances[name]) {
        instances[name] = factories[name]();
      }
      return instances[name];
    },
    configurable: true,
    enumerable: true
  });
});

module.exports = container;
