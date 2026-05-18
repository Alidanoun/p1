const { optionalAuth } = require('../../src/middleware/auth');
const TokenService = require('../../src/services/tokenService');

jest.mock('../../src/services/tokenService');
jest.mock('../../src/utils/logger', () => ({
  debug: jest.fn(),
  security: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

describe('optionalAuth middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      headers: {},
      cookies: {},
      ip: '127.0.0.1',
      query: {},
      body: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('should proceed as guest if no token is present', async () => {
    await optionalAuth(req, res, next);
    expect(req.user).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('should authenticate user and set req.user if a valid token is provided', async () => {
    req.headers['authorization'] = 'Bearer valid-token';
    const decodedPayload = { id: 'test-user-uuid', role: 'customer', sid: 'session-123', av: 1, pv: 1 };
    
    TokenService.verifyAccessToken.mockReturnValue(decodedPayload);
    TokenService.validateSessionState.mockResolvedValue({
      valid: true,
      session: { role: 'customer', branchId: null }
    });

    await optionalAuth(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('test-user-uuid');
    expect(req.user.role).toBe('customer');
    expect(next).toHaveBeenCalled();
  });

  it('should proceed as guest (user=null) and not error if token is expired', async () => {
    req.headers['authorization'] = 'Bearer expired-token';
    
    TokenService.verifyAccessToken.mockImplementation(() => {
      throw new Error('TOKEN_EXPIRED');
    });

    await optionalAuth(req, res, next);

    expect(req.user).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('should proceed as guest (user=null) and not error if token is invalid', async () => {
    req.headers['authorization'] = 'Bearer invalid-token';
    
    TokenService.verifyAccessToken.mockImplementation(() => {
      throw new Error('INVALID_TOKEN');
    });

    await optionalAuth(req, res, next);

    expect(req.user).toBeNull();
    expect(next).toHaveBeenCalled();
  });
});
