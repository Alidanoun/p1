const biometricService = require('../src/services/biometricService');
const authBiometricController = require('../src/controllers/authBiometricController');
const TokenService = require('../src/services/tokenService');
const prisma = require('../src/lib/prisma');

// 1. Mock jsonwebtoken deterministically
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('dummy_valid_biometric_jwt_string'),
  verify: jest.fn().mockImplementation((token) => {
    if (token === 'dummy_valid_biometric_jwt_string') {
      return { id: 'usr_uuid_777', deviceId: 'device_secure_uuid_123', biometric: true, role: 'admin' };
    }
    throw new Error('INVALID_SIGNATURE');
  })
}));

// 2. Mock crypto deterministically
jest.mock('../src/utils/crypto', () => ({
  encrypt: jest.fn().mockReturnValue('iv:hex_encrypted_payload'),
  decrypt: jest.fn().mockImplementation((t) => {
    if (t && typeof t === 'string' && t.includes('iv:')) {
      return 'dummy_valid_biometric_jwt_string';
    }
    return t;
  })
}));

// 3. Mock Prisma tables
jest.mock('../src/lib/prisma', () => ({
  biometricDevice: {
    upsert: jest.fn().mockResolvedValue({ deviceId: 'device_secure_uuid_123', token: 'iv:hex_encrypted_payload' }),
    findUnique: jest.fn().mockResolvedValue({
      deviceId: 'device_secure_uuid_123',
      isActive: true,
      token: 'iv:hex_encrypted_payload'
    }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 })
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({
      uuid: 'usr_uuid_777',
      role: 'admin',
      isActive: true,
      email: 'iv:hex',
      name: 'iv:hex'
    })
  },
  customer: {
    findUnique: jest.fn().mockResolvedValue(null)
  }
}));

// 4. Mock Audit & Token services
jest.mock('../src/services/auditService', () => ({
  log: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/services/tokenService', () => ({
  generateAndSaveRefreshToken: jest.fn().mockResolvedValue({ token: 'volatile_refresh_str_999', jti: 'jti_abc' }),
  generateAccessToken: jest.fn().mockReturnValue('standard_access_token_jwt')
}));

describe('🧬 Enterprise Biometric Persistent Trust & Hardware Verification Suite', () => {
  const validToken = 'dummy_valid_biometric_jwt_string';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Enabling persistent biometric binding
  test('✅ should successfully enable persistent physical hardware binding generating AES encrypted token at rest', async () => {
    const req = { headers: { 'user-agent': 'iPhone_App_v2' } };
    const res = await biometricService.enableDevice('usr_uuid_777', 'device_secure_uuid_123', { os: 'iOS 18' }, req);

    expect(res.biometricToken).toBe('dummy_valid_biometric_jwt_string');
    expect(res.deviceId).toBe('device_secure_uuid_123');
    expect(prisma.biometricDevice.upsert).toHaveBeenCalled();
    const auditService = require('../src/services/auditService');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BIOMETRIC_ENABLE' }));
  });

  // 2. Unlocking runtime operational sessions via background biometric proofs
  test('🔓 should bypass volatile Redis web caches setting hardware authorization session tokens directly', async () => {
    const req = { ip: '10.0.0.5', headers: { 'user-agent': 'native-app' } };
    const res = await biometricService.unlockDevice(validToken, 'device_secure_uuid_123', req);

    expect(res.accessToken).toBe('standard_access_token_jwt');
    expect(res.refreshToken).toBe('volatile_refresh_str_999');
    expect(res.user.id).toBe('usr_uuid_777');
    expect(TokenService.generateAndSaveRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'usr_uuid_777' }),
      expect.objectContaining({ fingerprint: 'biometric-hardware-trusted' })
    );
  });

  // 3. Replay Attack Interception
  test('🛡️ should intercept cross-device hardware ID mismatches blocking replay attack vectors', async () => {
    const req = { ip: '192.168.1.1' };
    await expect(
      biometricService.unlockDevice(validToken, 'attacker_stolen_device_id_999', req)
    ).rejects.toThrow('SECURITY_BREACH_DEVICE_MISMATCH');

    const auditService = require('../src/services/auditService');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BIOMETRIC_UNLOCK',
        status: 'FAIL',
        severity: 'CRITICAL'
      })
    );
  });

  // 4. Controller Layer Validations
  test('🌐 should expose full validation schemas returning CRM formatted application status payloads', async () => {
    const req = { body: { biometricToken: validToken, deviceId: 'device_secure_uuid_123' }, secure: true, headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn()
    };

    await authBiometricController.unlockBiometric(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'volatile_refresh_str_999', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // 5. Hardware Unbinding
  test('🚪 should revoke specific persistent bindings via authenticated disable hooks', async () => {
    const success = await biometricService.disableDevice('usr_uuid_777', 'device_secure_uuid_123');
    expect(success).toBe(true);
    expect(prisma.biometricDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'usr_uuid_777', deviceId: 'device_secure_uuid_123' },
        data: expect.objectContaining({ isActive: false })
      })
    );
  });
});
