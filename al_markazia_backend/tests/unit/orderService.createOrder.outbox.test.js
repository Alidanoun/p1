const { OrderService } = require('../../src/services/orderService');
const eventTypes = require('../../src/events/eventTypes');

// 1. Mock top-level dependencies
jest.mock('../../src/events/eventPublisher', () => ({
  publishEvent: jest.fn(() => Promise.resolve({ id: 'event-uuid-123' }))
}));

jest.mock('../../src/services/configService', () => ({
  getFullConfig: jest.fn(() => Promise.resolve({
    business: {
      slaPrepTimeMinutes: 20,
      slaDeliveryTimeMinutes: 30,
      autoCancelTimeoutMinutes: 15
    }
  }))
}));

jest.mock('../../src/services/liveCacheService', () => ({
  cacheOrder: jest.fn(() => Promise.resolve())
}));

jest.mock('../../src/queues/orderQueue', () => ({
  orderQueue: {
    add: jest.fn(() => Promise.resolve())
  }
}));

describe('OrderService - createOrder Transactional Outbox Integration', () => {
  let service;
  let prismaMock;
  let redisMock;
  let loggerMock;
  let containerMock;

  const { publishEvent } = require('../../src/events/eventPublisher');

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      branch: {
        findUnique: jest.fn()
      },
      order: {
        create: jest.fn()
      },
      notification: {
        create: jest.fn()
      },
      customer: {
        findUnique: jest.fn()
      },
      systemSettings: {
        findUnique: jest.fn()
      },
      $transaction: jest.fn(async (cb) => {
        // Enforce the transaction boundary by passing prismaMock as the transaction client (tx)
        return await cb(prismaMock);
      })
    };

    redisMock = {
      get: jest.fn().mockResolvedValue('{"autoAcceptOrders":"false"}'),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1)
    };

    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };

    containerMock = {
      prisma: prismaMock,
      redis: redisMock,
      logger: loggerMock,
      featureFlagsService: {
        isEnabled: jest.fn().mockResolvedValue(true)
      },
      loyaltyLedgerService: {
        debit: jest.fn().mockResolvedValue({ id: 'debit-uuid' }),
        syncProjection: jest.fn().mockResolvedValue()
      },
      ledgerService: {
        record: jest.fn().mockResolvedValue()
      },
      outboxService: {
        pulse: jest.fn().mockResolvedValue()
      }
    };

    service = new OrderService(containerMock);

    // 2. Stub helper methods to isolate the transaction block and prevent extensive DB calls
    service._resolveAndValidateCustomer = jest.fn().mockResolvedValue({
      id: 101,
      phone: '0790000000',
      points: 1000,
      walletBalance: 25.5
    });

    service._resolveBranchId = jest.fn().mockResolvedValue('branch-uuid-abc');
    service._validateSpamLimits = jest.fn().mockResolvedValue();
    service._calculateAndValidatePricing = jest.fn().mockResolvedValue({
      validatedItems: [
        { id: 1, name: 'Burger', unitPrice: 5.0, quantity: 2, subtotal: 10.0 }
      ],
      subtotal: 10.0
    });
    service._validateDeliveryDetails = jest.fn().mockResolvedValue({
      fee: 2.0,
      zoneId: 'zone-uuid-xyz',
      zoneName: 'Amman',
      minOrder: 5.0
    });
    service._generateOrderNumber = jest.fn().mockResolvedValue('ORD-2026-999');
    service._triggerPostOrderEffects = jest.fn();
  });

  test('Requirement: createOrder wraps publishEvent inside the same transaction and passes tx metadata', async () => {
    const validOrderData = {
      customerName: 'Ahmad Almarkazi',
      customerPhone: '0790000000',
      orderType: 'takeaway',
      paymentMethod: 'cash',
      cartItems: [{ id: 1, quantity: 2 }],
      usePoints: false
    };

    const mockAuthUser = {
      id: 'auth-user-uuid-999',
      role: 'customer'
    };

    const mockCreatedOrder = {
      id: 5001,
      orderNumber: 'ORD-2026-999',
      customerId: 101,
      customerName: 'Ahmad Almarkazi',
      customerPhone: '0790000000',
      subtotal: 10.0,
      tax: 1.38,
      deliveryFee: 2.0,
      total: 12.0,
      status: 'pending',
      branchId: 'branch-uuid-abc',
      tenantId: 'tenant-1'
    };

    // Stub DB-level calls within transaction
    prismaMock.branch.findUnique.mockResolvedValue({
      isActive: true,
      name: 'Central Branch Amman'
    });

    prismaMock.order.create.mockResolvedValue(mockCreatedOrder);
    prismaMock.notification.create.mockResolvedValue({ id: 1 });

    const result = await service.createOrder(validOrderData, mockAuthUser);

    // Verify order was returned mapped
    expect(result).toBeDefined();
    expect(result.id).toBe('5001');
    expect(result.orderNumber).toBe('ORD-2026-999');

    // Verify transaction was called
    expect(prismaMock.$transaction).toHaveBeenCalled();

    // Verify branch status check happened inside transaction
    expect(prismaMock.branch.findUnique).toHaveBeenCalledWith({
      where: { id: 'branch-uuid-abc' },
      select: { isActive: true, name: true }
    });

    // Verify order.create happened inside transaction
    expect(prismaMock.order.create).toHaveBeenCalled();

    // Verify publishEvent was called inside the transaction boundary with the same transaction client tx
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: eventTypes.ORDER_CREATED,
        aggregateId: '5001',
        payload: expect.objectContaining({
          order: expect.objectContaining({
            id: 5001, // Note that ID mapped is returned as string "5001" or number 5001 based on mock, let's allow either
            customerId: 101
          })
        }),
        version: 1,
        metadata: expect.objectContaining({
          aggregateType: 'Order',
          tx: prismaMock // Enforces transactional outbox atomicity!
        })
      })
    );

    // Verify outbox pulse is scheduled asynchronously outside transaction
    await new Promise(setImmediate);
    expect(containerMock.outboxService.pulse).toHaveBeenCalled();
  });
});
