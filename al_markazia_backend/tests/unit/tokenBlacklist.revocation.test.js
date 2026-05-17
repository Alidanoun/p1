const tokenBlacklistService = require('../../src/services/tokenBlacklistService');
const { checkTokenNotBlacklisted } = require('../../src/middleware/tokenBlacklistCheck');
const redis = require('../../src/lib/redis');

describe('Token Blacklist & Revocation Latency Guard', () => {
  const testUserId = 'user-uuid-999';
  const testJti = 'test-jti-token-xyz';

  beforeEach(async () => {
    // Clean up Redis before each test
    await redis.del(`blacklist:${testJti}`);
    await redis.del(`session:${testUserId}:${testJti}`);
  });

  afterAll(async () => {
    await redis.del(`blacklist:${testJti}`);
    await redis.del(`session:${testUserId}:${testJti}`);
  });

  test('Requirement: Blacklist and verify a single token (JTI)', async () => {
    // 1. Initially it should not be blacklisted
    let isRevoked = await tokenBlacklistService.isBlacklisted(testJti);
    expect(isRevoked).toBe(false);

    // 2. Blacklist the JTI
    await tokenBlacklistService.blacklist(testJti, testUserId, 'TEST_REVOCATION');

    // 3. Now it must be blacklisted
    isRevoked = await tokenBlacklistService.isBlacklisted(testJti);
    expect(isRevoked).toBe(true);
  });

  test('Requirement: Blacklist all sessions of a user', async () => {
    const sessionKey1 = `session:${testUserId}:jti-1`;
    const sessionKey2 = `session:${testUserId}:jti-2`;

    // Setup active sessions in Redis
    await redis.set(sessionKey1, JSON.stringify({ sid: 'jti-1', uid: testUserId }));
    await redis.set(sessionKey2, JSON.stringify({ sid: 'jti-2', uid: testUserId }));

    // Run user sessions invalidation
    await tokenBlacklistService.blacklistUserSessions(testUserId, 'TEST_BULK_REVOCATION');

    // Verify both JTIs are added to blacklist
    expect(await tokenBlacklistService.isBlacklisted('jti-1')).toBe(true);
    expect(await tokenBlacklistService.isBlacklisted('jti-2')).toBe(true);

    // Verify both session keys are deleted from Redis
    expect(await redis.get(sessionKey1)).toBeNull();
    expect(await redis.get(sessionKey2)).toBeNull();

    // Clean up blacklist keys
    await redis.del('blacklist:jti-1');
    await redis.del('blacklist:jti-2');
  });

  test('Requirement: Middleware blocks request if JTI is blacklisted', async () => {
    const req = {
      user: { id: testUserId, jti: testJti },
      ip: '127.0.0.1'
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    const next = jest.fn();

    // 1. When NOT blacklisted, it should call next()
    await checkTokenNotBlacklisted(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();

    // 2. Blacklist the token
    await tokenBlacklistService.blacklist(testJti, testUserId, 'TEST_MIDDLEWARE');

    next.mockClear();
    res.status.mockClear();

    // 3. When blacklisted, it should block with 401 and SESSION_REVOKED
    await checkTokenNotBlacklisted(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'SESSION_REVOKED'
    }));
  });

  test('Requirement: Middleware fail-open safety on Redis failure', async () => {
    const req = {
      user: { id: testUserId, jti: testJti },
      ip: '127.0.0.1'
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    const next = jest.fn();

    // Mock Redis get to throw error
    const originalGet = redis.get;
    redis.get = jest.fn().mockRejectedValue(new Error('Redis Connection Failure'));

    try {
      // Middleware should allow request through (fail-open) and call next()
      await checkTokenNotBlacklisted(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      redis.get = originalGet;
    }
  });
});
