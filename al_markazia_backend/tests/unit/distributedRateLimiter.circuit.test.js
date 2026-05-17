const { DistributedRateLimiter } = require('../../src/middleware/advancedRateLimiter');
const { resetMetrics } = require('../../src/utils/metrics');

describe('DistributedRateLimiter Circuit Breaker Protection Suite', () => {
  let limiter;
  let redisMock;

  beforeEach(() => {
    resetMetrics();

    redisMock = {
      eval: jest.fn()
    };

    limiter = new DistributedRateLimiter({
      scope: 'orders',
      windowMs: 60000,
      maxRequests: 3,
      keyPrefix: 'test:orders:',
      redis: redisMock
    });

    // Shorten circuit breaker reset timeout for testing
    limiter.circuitBreaker.resetTimeout = 100;
  });

  test('Requirement: Circuit Breaker transitions to OPEN after 3 consecutive failures', async () => {
    redisMock.eval.mockRejectedValue(new Error('Connection failure'));

    // Trigger 3 failures
    await limiter._checkLimit('test:key');
    await limiter._checkLimit('test:key');
    await limiter._checkLimit('test:key');

    expect(limiter.circuitBreaker.state).toBe('OPEN');
    expect(limiter.circuitBreaker.failures).toBe(3);

    // Call 4: Should instantly fallback without calling Redis again
    redisMock.eval.mockClear();
    const res = await limiter._checkLimit('test:key');

    expect(res.fallback).toBe(true);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  test('Requirement: Circuit Breaker transitions to HALF_OPEN and resets to CLOSED upon success', async () => {
    redisMock.eval.mockRejectedValue(new Error('Connection failure'));

    // Trip the circuit breaker
    await limiter._checkLimit('test:key');
    await limiter._checkLimit('test:key');
    await limiter._checkLimit('test:key');

    expect(limiter.circuitBreaker.state).toBe('OPEN');

    // Wait for the resetTimeout to pass
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should transition to HALF_OPEN when queried
    expect(limiter.circuitBreaker.isOpen()).toBe(false); // HALF_OPEN allows requests
    expect(limiter.circuitBreaker.state).toBe('HALF_OPEN');

    // Emulate Redis success for the probe request
    redisMock.eval.mockResolvedValue([1, 1]);

    const res = await limiter._checkLimit('test:key');
    expect(res.allowed).toBe(true);
    expect(res.fallback).toBe(false);
    expect(redisMock.eval).toHaveBeenCalled();

    // Verify circuit breaker returned to CLOSED state
    expect(limiter.circuitBreaker.state).toBe('CLOSED');
    expect(limiter.circuitBreaker.failures).toBe(0);
  });
});
