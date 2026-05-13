const Decimal = require('decimal.js');
const { HappyHourService, TimezoneCache } = require('../../src/services/happyHourService');

describe('HappyHourService Timezone Hardening & Dynamic Pricing Suite', () => {
  let service;
  let prismaMock;
  let redisMock;
  let loggerMock;

  beforeEach(() => {
    prismaMock = {
      happyHour: {
        findMany: jest.fn()
      },
      order: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      branch: {
        findUnique: jest.fn()
      },
      customer: {
        findUnique: jest.fn()
      },
      orderAuditLog: {
        create: jest.fn()
      }
    };

    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1)
    };

    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    service = new HappyHourService({
      prisma: prismaMock,
      redis: redisMock,
      logger: loggerMock
    });
  });

  afterEach(async () => {
    await service.destroy();
  });

  test('Scenario 1: Applies PERCENTAGE discount successfully within branch timezone window', async () => {
    // Branch in Dubai (UTC+4). Happy Hour configured 18:00 to 20:00 local Dubai time.
    // Order placed at 18:30 Dubai time -> 14:30 UTC.
    const orderCreatedAt = new Date('2026-05-13T14:30:00Z');

    prismaMock.branch.findUnique.mockResolvedValue({ timezone: 'Asia/Dubai' });
    prismaMock.happyHour.findMany.mockResolvedValue([{
      id: 'hh-1',
      branchId: 'br-dubai',
      startTime: '18:00',
      endTime: '20:00',
      discountValue: new Decimal(20), // 20%
      discountType: 'PERCENTAGE',
      rewardMultiplier: new Decimal(1.5),
      daysOfWeek: [3], // Wednesday (May 13, 2026 is Wednesday)
      isActive: true,
      timezone: 'Asia/Dubai'
    }]);

    prismaMock.order.findUnique.mockResolvedValue({
      id: 101,
      branchId: 'br-dubai',
      subtotal: new Decimal(100.00),
      total: new Decimal(100.00),
      createdAt: orderCreatedAt,
      branch: { timezone: 'Asia/Dubai' }
    });

    prismaMock.order.update.mockImplementation(({ data }) => Promise.resolve({
      id: 101,
      total: new Decimal(data.total)
    }));

    const result = await service.applyDiscount(101, 50);

    expect(result).not.toBeNull();
    expect(result.applied).toBe(true);
    expect(result.discountAmount).toBe('20'); // 20% of 100 = 20
    expect(result.newTotal).toBe('80');
    expect(prismaMock.orderAuditLog.create).toHaveBeenCalled();
  });

  test('Scenario 2: Skips discount if transaction timestamp falls outside branch timezone window', async () => {
    // Order placed at 17:00 Dubai time -> 13:00 UTC (Outside 18:00-20:00 window)
    const orderCreatedAt = new Date('2026-05-13T13:00:00Z');

    prismaMock.branch.findUnique.mockResolvedValue({ timezone: 'Asia/Dubai' });
    prismaMock.happyHour.findMany.mockResolvedValue([{
      id: 'hh-1',
      branchId: 'br-dubai',
      startTime: '18:00',
      endTime: '20:00',
      discountValue: new Decimal(20),
      discountType: 'PERCENTAGE',
      daysOfWeek: [3],
      isActive: true,
      timezone: 'Asia/Dubai'
    }]);

    prismaMock.order.findUnique.mockResolvedValue({
      id: 102,
      branchId: 'br-dubai',
      subtotal: new Decimal(100.00),
      total: new Decimal(100.00),
      createdAt: orderCreatedAt,
      branch: { timezone: 'Asia/Dubai' }
    });

    const result = await service.applyDiscount(102, 50);

    expect(result).toBeNull();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  test('Scenario 3: Resolves unsupported timezones using global safe fallback (Africa/Cairo)', async () => {
    const orderCreatedAt = new Date('2026-05-13T16:00:00Z'); // 19:00 Cairo time (UTC+3)

    prismaMock.branch.findUnique.mockResolvedValue({ timezone: 'Invalid/Timezone_String' });
    prismaMock.happyHour.findMany.mockResolvedValue([{
      id: 'hh-fallback',
      branchId: 'br-cairo',
      startTime: '18:00',
      endTime: '20:00',
      discountValue: new Decimal(15),
      discountType: 'PERCENTAGE',
      daysOfWeek: [3],
      isActive: true,
      timezone: null // Inherits fallback
    }]);

    prismaMock.order.findUnique.mockResolvedValue({
      id: 103,
      branchId: 'br-cairo',
      subtotal: new Decimal(200.00),
      total: new Decimal(200.00),
      createdAt: orderCreatedAt,
      branch: { timezone: 'Invalid/Timezone_String' }
    });

    prismaMock.order.update.mockImplementation(({ data }) => Promise.resolve({
      id: 103,
      total: new Decimal(data.total)
    }));

    const result = await service.applyDiscount(103, 50);

    expect(result).not.toBeNull();
    expect(result.applied).toBe(true);
    expect(result.discountAmount).toBe('30'); // 15% of 200 = 30
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported timezone requested'),
      expect.any(Object)
    );
  });

  test('Scenario 4: Validates FIXED discount limits correctly using Decimal precision', async () => {
    const orderCreatedAt = new Date('2026-05-13T16:00:00Z'); // 19:00 Cairo time

    prismaMock.branch.findUnique.mockResolvedValue({ timezone: 'Africa/Cairo' });
    prismaMock.happyHour.findMany.mockResolvedValue([{
      id: 'hh-fixed',
      branchId: 'br-cairo',
      startTime: '18:00',
      endTime: '20:00',
      discountValue: new Decimal(50.00), // Fixed 50 JOD discount
      discountType: 'FIXED',
      rewardMultiplier: new Decimal(2.0),
      daysOfWeek: [3],
      isActive: true,
      timezone: 'Africa/Cairo'
    }]);

    // Order subtotal is 30 JOD. Fixed discount is 50 JOD.
    // Should cap discount amount exactly at subtotal (30 JOD) to prevent negative totals!
    prismaMock.order.findUnique.mockResolvedValue({
      id: 104,
      branchId: 'br-cairo',
      subtotal: new Decimal(30.00),
      total: new Decimal(30.00),
      createdAt: orderCreatedAt,
      branch: { timezone: 'Africa/Cairo' }
    });

    prismaMock.order.update.mockImplementation(({ data }) => Promise.resolve({
      id: 104,
      total: new Decimal(data.total)
    }));

    const result = await service.applyDiscount(104, 50);

    expect(result).not.toBeNull();
    expect(result.discountAmount).toBe('30');
    expect(result.newTotal).toBe('0');
  });

  test('Scenario 5: TimezoneCache logic caching layer isolation', async () => {
    redisMock.get.mockResolvedValueOnce('Asia/Riyadh');
    
    const cache = new TimezoneCache(redisMock);
    const tz = await cache.getBranchTimezone('br-1', prismaMock);

    expect(tz).toBe('Asia/Riyadh');
    expect(prismaMock.branch.findUnique).not.toHaveBeenCalled();
  });
});
