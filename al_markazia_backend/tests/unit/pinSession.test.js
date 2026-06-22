const { checkPermission } = require('../../src/middleware/permissionMiddleware');
const redis = require('../../src/lib/redis');
const prisma = require('../../src/lib/prisma');

jest.mock('../../src/lib/redis', () => ({
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  incr: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1)
}));

jest.mock('../../src/lib/prisma', () => ({
  user: {
    findFirst: jest.fn()
  },
  branchPermissions: {
    findUnique: jest.fn()
  }
}));

// Define mockLog on global object before the mock factory evaluates
global.mockLog = jest.fn().mockResolvedValue({});

jest.mock('../../src/services/auditService', () => {
  const mockProxy = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'log') {
        return global.mockLog;
      }
      return jest.fn();
    }
  });
  return mockProxy;
});

jest.mock('../../src/utils/logger', () => ({
  debug: jest.fn(),
  security: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

describe('Manager PIN Session Caching & Hardening', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      method: 'POST',
      body: {},
      headers: {
        'user-agent': 'Test Agent'
      },
      ip: '192.168.1.10',
      user: { id: 'user-uuid-1', role: 'branch_manager', branchId: 1 }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    jest.clearAllMocks();
    global.mockLog.mockClear();

    // Default mock behavior for permissions matrix cache hit
    redis.get.mockImplementation(async (key) => {
      if (key.includes('permissions_matrix')) {
        return JSON.stringify({ settings: 'EDIT_PIN' });
      }
      return null;
    });
  });

  test('should bypass PIN if verified count is < 3 and increment usage', async () => {
    // Mock redis.get to return '1' for PIN cache
    redis.get.mockImplementation(async (key) => {
      if (key.includes('permissions_matrix')) {
        return JSON.stringify({ settings: 'EDIT_PIN' });
      }
      if (key.includes('manager_pin_verified')) {
        return '1'; // already bypassed once
      }
      return null;
    });

    const middleware = checkPermission('settings', 'EDIT_PIN');
    await middleware(req, res, next);

    expect(redis.get).toHaveBeenCalled();
    expect(redis.incr).toHaveBeenCalled();
    expect(global.mockLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PIN_CACHE_BYPASS',
      metadata: expect.objectContaining({
        consecutiveBypasses: 2
      })
    }));
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should require PIN if verified count is >= 3', async () => {
    // Mock redis.get to return '3' for PIN cache
    redis.get.mockImplementation(async (key) => {
      if (key.includes('permissions_matrix')) {
        return JSON.stringify({ settings: 'EDIT_PIN' });
      }
      if (key.includes('manager_pin_verified')) {
        return '3'; // bypassed 3 times already
      }
      return null;
    });

    const middleware = checkPermission('settings', 'EDIT_PIN');
    await middleware(req, res, next);

    expect(redis.get).toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
    expect(global.mockLog).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PIN_REQUIRED'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('should lock the Redis key to the request session fingerprint (user ID + IP + UserAgent)', async () => {
    redis.get.mockImplementation(async (key) => {
      if (key.includes('permissions_matrix')) {
        return JSON.stringify({ settings: 'EDIT_PIN' });
      }
      if (key.includes('manager_pin_verified')) {
        return '1';
      }
      return null;
    });

    const middleware = checkPermission('settings', 'EDIT_PIN');

    // First request
    await middleware(req, res, next);
    const calls = redis.get.mock.calls;
    const pinCacheCall1 = calls.find(call => call[0].includes('manager_pin_verified'));
    const key1 = pinCacheCall1[0];

    // Reset calls for second request
    redis.get.mockClear();
    
    // Second request with different IP
    req.ip = '10.0.0.5';
    await middleware(req, res, next);
    const calls2 = redis.get.mock.calls;
    const pinCacheCall2 = calls2.find(call => call[0].includes('manager_pin_verified'));
    const key2 = pinCacheCall2[0];

    expect(key1).not.toBe(key2);
    expect(key1).toContain('user-uuid-1');
    expect(key2).toContain('user-uuid-1');
  });
});
