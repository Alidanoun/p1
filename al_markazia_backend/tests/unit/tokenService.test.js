jest.mock('uuid', () => ({
  v4: () => 'mock-uuid-jti'
}));

const TokenService = require('../../src/services/tokenService');
const jwt = require('jsonwebtoken');
const { JWT_PRIVATE_KEY, JWT_PUBLIC_KEY } = require('../../src/config/secrets');

/**
 * 🧪 TokenService Unit Tests
 */
describe('TokenService', () => {
  const mockUser = {
    uuid: 'test-uuid-123',
    role: 'admin',
    phone: '0790000000'
  };

  describe('generateAccessToken', () => {
    it('should generate a valid JWT access token', () => {
      const jti = 'mock-jti';
      const token = TokenService.generateAccessToken(mockUser, jti);
      
      expect(token).toBeDefined();
      const decoded = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
      
      expect(decoded.id).toBe(mockUser.uuid);
      expect(decoded.role).toBe(mockUser.role);
      expect(decoded.jti).toBe(jti);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid token and return decoded payload', () => {
      const jti = 'mock-jti';
      const token = jwt.sign({ id: '123', role: 'admin', jti }, JWT_PRIVATE_KEY, { algorithm: 'RS256' });
      
      const decoded = TokenService.verifyAccessToken(token);
      expect(decoded.id).toBe('123');
      expect(decoded.jti).toBe(jti);
    });

    it('should throw error for invalid tokens', () => {
      expect(() => {
        TokenService.verifyAccessToken('invalid.token.here');
      }).toThrow('INVALID_TOKEN');
    });
  });
});
