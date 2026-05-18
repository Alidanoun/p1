const analytics = require('../../src/projections/analyticsProjection');
const redis = require('../../src/lib/redis');

// Mock dependencies
jest.mock('../../src/lib/prisma', () => ({
  order: {
    findMany: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../../src/socket', () => ({
  isReady: () => false
}));

// Mock Redis completely to verify central cluster metrics updating
jest.mock('../../src/lib/redis', () => {
  let store = {};
  let hashStore = {};
  
  return {
    get: jest.fn().mockImplementation(async (key) => store[key] || null),
    set: jest.fn().mockImplementation(async (key, val) => {
      store[key] = val;
      return 'OK';
    }),
    hset: jest.fn().mockImplementation(async (key, field, val) => {
      if (!hashStore[key]) hashStore[key] = {};
      hashStore[key][field] = val;
      return 1;
    }),
    hget: jest.fn().mockImplementation(async (key, field) => {
      return hashStore[key]?.[field] || null;
    }),
    hgetall: jest.fn().mockImplementation(async (key) => {
      return hashStore[key] || {};
    }),
    hdel: jest.fn().mockImplementation(async (key, field) => {
      if (hashStore[key]) {
        delete hashStore[key][field];
      }
      return 1;
    }),
    del: jest.fn().mockImplementation(async (key) => {
      if (Array.isArray(key)) {
        key.forEach(k => {
          delete store[k];
          delete hashStore[k];
        });
      } else {
        delete store[key];
        delete hashStore[key];
      }
      return 1;
    }),
    keys: jest.fn().mockImplementation(async (pattern) => {
      const allKeys = [...Object.keys(store), ...Object.keys(hashStore)];
      if (pattern === 'analytics:*') {
        return allKeys.filter(k => k.startsWith('analytics:'));
      }
      return allKeys;
    }),
    publisher: {
      publish: jest.fn().mockResolvedValue(1)
    },
    subscriber: {
      subscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn()
    }
  };
});

describe('Distributed Analytics Projection Tests', () => {
  beforeEach(async () => {
    await analytics.reset();
    jest.clearAllMocks();
  });

  test('Updates statistics in Redis centrally and updates local memory', async () => {
    await analytics.handleCreated({
      id: 1,
      branchId: 'branch-A',
      status: 'pending',
      orderType: 'takeaway',
      version: 1
    });

    // Wait for background tasks to execute
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify Redis active orders set
    expect(redis.hset).toHaveBeenCalledWith(
      'analytics:active_orders:branch-A',
      '1',
      expect.stringContaining('"status":"pending"')
    );

    // Verify local metrics reflect the new order
    const localMetrics = analytics.getMetrics('branch-A');
    expect(localMetrics.counts.total).toBe(1);
    expect(localMetrics.statusDistribution.pending).toBe(1);
    expect(localMetrics.typeDistribution.takeaway).toBe(1);
  });

  test('Monotonic cluster guard rejects older order versions', async () => {
    // Treat first call as version 2
    analytics.handleStatusChange({
      order: { id: 10, branchId: 'branch-A', status: 'delivered', version: 2 }
    });

    // Wait for background tasks to execute
    await new Promise(resolve => setTimeout(resolve, 50));

    // Treat second call as version 1 (which should be ignored)
    analytics.handleStatusChange({
      order: { id: 10, branchId: 'branch-A', status: 'preparing', version: 1 }
    });

    // Wait for background tasks to execute
    await new Promise(resolve => setTimeout(resolve, 50));

    const localMetrics = analytics.getMetrics('branch-A');
    // State should remain delivered and NOT get reverted to preparing
    expect(localMetrics.statusDistribution.delivered).toBe(1);
    expect(localMetrics.statusDistribution.preparing).toBe(0);
  });
});
