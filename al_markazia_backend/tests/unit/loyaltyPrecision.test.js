const { LoyaltyService } = require('../../src/services/loyaltyService');
const Decimal = require('decimal.js');

describe('LoyaltyService Precision & Enterprise Ledger Validation Suite', () => {
  let service;
  let prismaMock;
  let loggerMock;

  beforeEach(() => {
    prismaMock = {
      customer: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      customerAuditLog: {
        create: jest.fn()
      },
      $transaction: jest.fn(async (cb) => {
        return await cb(prismaMock);
      })
    };

    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };

    service = new LoyaltyService({
      prisma: prismaMock,
      logger: loggerMock
    });
  });

  test('Requirement 1: Resolves classic float precision leaks perfectly mapping decimal rules', () => {
    // 100.30 * 1.33 = 133.39900000000002 natively -> Banking Round Half Up gives exactly 133
    const result = service.calculateEarnedPoints(100.30, 1.33, 1.0);
    expect(result).toBe(133);
  });

  test('Requirement 2: Edge Case massive integer boundary orders preserve scale perfectly', () => {
    // 999999.99 * 2.5 = 2499999.975 -> rounds gracefully to 2500000
    const result = service.calculateEarnedPoints(999999.99, 2.5, 1.0);
    expect(result).toBe(2500000);
  });

  test('Requirement 3: Edge Case ultra-micro amounts round down beneath fractional thresholds', () => {
    // 0.01 * 1.0 = 0.01 -> rounds to 0 integer points
    const result = service.calculateEarnedPoints(0.01, 1.0, 1.0);
    expect(result).toBe(0);
  });

  test('Requirement 4: Enforces strict non-negative thresholds blocking extraction beneath zero ledger floors', async () => {
    prismaMock.customer.findUnique.mockResolvedValueOnce({
      id: 101,
      points: 10,
      uuid: 'test-uuid'
    });

    await expect(service.adjustPoints(101, -50, 'Excessive deduction attempt'))
      .rejects.toThrow('INSUFFICIENT_POINTS');

    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[Loyalty] Negative balance prevented',
      expect.objectContaining({
        customerId: 101,
        attemptedAdjustment: -50,
        currentBalance: 10
      })
    );
  });

  test('Requirement 5: Accommodates precise redemption logic evaluating fractional scaling limits', () => {
    // 150 points * 0.015 = 2.25 currency units exactly
    const cash = service.calculateRedemption(150, 0.015);
    expect(cash).toBe(2.25);
  });
});
