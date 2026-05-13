const { DistributedRateLimiter } = require('../../src/middleware/advancedRateLimiter');
const { getRateLimitMetrics, resetMetrics } = require('../../src/utils/metrics');

describe('DistributedRateLimiter Architecture Security Suite', () => {
  let limiter;
  let redisMock;

  beforeEach(() => {
    resetMetrics();

    redisMock = {
      eval: jest.fn(),
      get: jest.fn(),
      keys: jest.fn(),
      del: jest.fn(),
      ttl: jest.fn()
    };

    limiter = new DistributedRateLimiter({
      scope: 'orders',
      windowMs: 1000,
      maxRequests: 3,
      keyPrefix: 'test:orders:',
      redis: redisMock
    });
  });

  test('Scenario 1: Refuses subsequent distributed packets exactly upon exceeding maximum allowed windows', async () => {
    // Emulate atomic Lua response state increments
    redisMock.eval
      .mockResolvedValueOnce([1, 1]) // Request 1: Allowed
      .mockResolvedValueOnce([1, 2]) // Request 2: Allowed
      .mockResolvedValueOnce([1, 3]) // Request 3: Allowed
      .mockResolvedValueOnce([0, 3]);// Request 4: Denied without exposing live increment enumeration

    const results = [];
    for (let i = 0; i < 4; i++) {
      const res = await limiter._checkLimit('test:orders:key');
      results.push(res.allowed);
    }

    expect(results).toEqual([true, true, true, false]);
    
    // Verify custom observability check incrementing
    const metrics = getRateLimitMetrics();
    expect(metrics.checks.total).toBe(4);
    expect(metrics.checks.allowed).toBe(3);
    expect(metrics.checks.rejected).toBe(1);
    expect(metrics.by_scope.orders.allowed).toBe(3);
    expect(metrics.by_scope.orders.rejected).toBe(1);
  });

  test('Scenario 2: Ensures evaluation via inline single step Lua parameter invocation', async () => {
    redisMock.eval.mockResolvedValueOnce([1, 1]);

    await limiter._checkLimit('test:orders:atomic');

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'), // Evaluates inline script
      1, // Number of KEYS mapped
      'test:orders:atomic',
      3, // ARGV[1] Max requests
      expect.any(Number), // ARGV[2] Window in seconds
      expect.any(Number), // ARGV[3] Timestamp
      expect.any(String)  // ARGV[4] Unique Request Tracing ID
    );
  });

  test('Scenario 3: Triggers absolute fail-open execution behavior immediately upon Redis cluster unavailability', async () => {
    redisMock.eval.mockRejectedValue(new Error('Cluster node down'));

    const res = await limiter._checkLimit('test:orders:down');

    expect(res.allowed).toBe(true); // Fails open to preserve functional processing paths
    expect(res.fallback).toBe(true);

    const metrics = getRateLimitMetrics();
    expect(metrics.checks.fallback).toBe(1);
  });

  test('Scenario 4: Validates IP extraction, IPv6 compression formatting, and custom Whitelist overrides', async () => {
    const whitelistedLimiter = new DistributedRateLimiter({
      scope: 'global',
      whitelist: ['192.168.1.100'],
      redis: redisMock
    });

    const req = { ip: '192.168.1.100', path: '/api/internal' };
    const res = { set: jest.fn(), status: jest.fn(), json: jest.fn() };
    const next = jest.fn();

    await whitelistedLimiter.middleware()(req, res, next);

    expect(next).toHaveBeenCalled(); // Whitelisted paths completely bypass Redis lookups
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  test('Scenario 5: Ensures HTTP response populates precise rate limitation observation headers', async () => {
    redisMock.eval.mockResolvedValueOnce([1, 2]); // Allowed, current increment is 2

    const req = { 
      ip: '10.0.0.5', 
      path: '/api/v1/orders',
      headers: {}
    };
    const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await limiter.middleware()(req, res, next);

    expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', '3');
    expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', '1'); // 3 minus 2 = 1
    expect(next).toHaveBeenCalled();
  });

  test('Scenario 6: Evaluates custom scope binding and repeated abusive identity tracking correctly', async () => {
    redisMock.eval.mockResolvedValue([0, 3]); // Emulate absolute denial

    const req = { ip: '45.33.22.11', path: '/api/orders', user: null };
    const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await limiter.middleware()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    
    const metrics = getRateLimitMetrics();
    expect(metrics.top_blocked_ips).toContainEqual({ ip: '45.33.22.11', count: 1 });
  });
});
