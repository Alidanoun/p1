const { NotificationService } = require('../src/services/notificationService');
const { getMyNotifications, markAsRead } = require('../src/controllers/notificationController');

// Mock container (prefixed with mock)
const mockContainer = {
  prisma: {
    notificationLog: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn()
    }
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
};

// Mock express req/res
const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Mock prisma dependency inside controllers
jest.mock('../src/lib/prisma', () => ({
  notificationLog: {
    findMany: (...args) => mockContainer.prisma.notificationLog.findMany(...args),
    findUnique: (...args) => mockContainer.prisma.notificationLog.findUnique(...args),
    update: (...args) => mockContainer.prisma.notificationLog.update(...args)
  }
}));

// Mock Socket.io dependency
jest.mock('../src/socket', () => ({
  getIO: () => ({
    to: () => ({
      emit: () => {}
    })
  })
}));

describe('FCM Broadcast and Reconciler Tests', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(mockContainer);
  });

  test('✅ _mapToSchemaType should support system.broadcast', () => {
    const type1 = service._mapToSchemaType('broadcast');
    const type2 = service._mapToSchemaType('system.broadcast');
    
    expect(type1).toBe('PROMOTION');
    expect(type2).toBe('PROMOTION');
  });

  test('✅ reconcile should dispatch pending broadcasts instead of just updating status to SENT', async () => {
    const broadcastNotif = {
      id: 99,
      type: 'system.broadcast',
      title: 'Global Offer',
      body: 'Get 50% off!',
      orderId: null,
      retries: 0
    };

    mockContainer.prisma.notificationLog.findMany.mockResolvedValue([broadcastNotif]);
    
    // Spy on dispatch
    const dispatchSpy = jest.spyOn(service, 'dispatch').mockResolvedValue();

    await service.reconcile();

    // Verification: dispatch was called with the broadcast notification and placeholder order context
    expect(dispatchSpy).toHaveBeenCalledWith(broadcastNotif, { id: 0 });
    // It should not call update immediately with SENT in the loop (except through dispatch itself)
    expect(mockContainer.prisma.notificationLog.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: { status: 'SENT' }
      })
    );
  });

  test('✅ getMyNotifications should query broadcasts (all) and map fields correctly', async () => {
    const req = {
      user: { id: 'customer-uuid-123', role: 'customer' }
    };
    const res = mockResponse();

    const dbLogs = [
      {
        id: 1,
        userId: 'customer-uuid-123',
        customerId: 12,
        orderId: 45,
        type: 'status_change',
        title: 'Title 1',
        body: 'Message body 1',
        status: 'SENT',
        readAt: null,
        createdAt: new Date()
      },
      {
        id: 2,
        userId: 'all',
        customerId: null,
        orderId: null,
        type: 'system.broadcast',
        title: 'Broadcast Title',
        body: 'Broadcast message body',
        status: 'SENT',
        readAt: null,
        createdAt: new Date()
      }
    ];

    mockContainer.prisma.notificationLog.findMany.mockResolvedValue(dbLogs);

    await getMyNotifications(req, res);

    // Verify findMany was called with 'all' in userId filter
    expect(mockContainer.prisma.notificationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { in: ['customer-uuid-123', 'all'] }
        })
      })
    );

    // Verify mapping of isRead and message
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 1,
        message: 'Message body 1',
        isRead: false
      }),
      expect.objectContaining({
        id: 2,
        message: 'Broadcast message body',
        isRead: false
      })
    ]);
  });

  test('✅ markAsRead should permit reading broadcast (all) notifications without writing to DB', async () => {
    const req = {
      params: { id: '99' },
      user: { id: 'customer-uuid-123', role: 'customer' }
    };
    const res = mockResponse();

    const broadcastLog = {
      id: 99,
      userId: 'all',
      status: 'SENT',
      readAt: null
    };

    mockContainer.prisma.notificationLog.findUnique.mockResolvedValue(broadcastLog);

    await markAsRead(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    // It should not call update for 'all' targeted notifications
    expect(mockContainer.prisma.notificationLog.update).not.toHaveBeenCalled();
  });

  test('✅ notificationEngineConsumer wildcard handler resolves nested orderId and status', async () => {
    const notificationEngineConsumer = require('../src/events/consumers/notificationEngineConsumer');
    const handler = notificationEngineConsumer.handlers['*'];
    
    // Mock container dependencies
    const mockPrisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 14,
          orderNumber: 'AMM-123',
          customer: { uuid: 'cust-123', fcmToken: 'token-abc' }
        })
      },
      notificationLog: {
        create: jest.fn().mockResolvedValue({ id: 88 }),
        update: jest.fn().mockResolvedValue({ id: 88 })
      }
    };
    
    // Inject mocks into container
    const container = require('../src/lib/container');
    container.prisma = mockPrisma;
    
    // Spy on prototype method
    const generateSpy = jest.spyOn(NotificationService.prototype, '_generateStatusContent')
      .mockReturnValue({ title: 'Test Title', message: 'Test Msg' });
    
    // Mock firebaseService
    const firebaseService = require('../src/services/firebaseService');
    const sendToTokenSpy = jest.spyOn(firebaseService, 'sendToToken').mockResolvedValue('msg-id-123');
    
    // Event payload with nested order ID
    const event = {
      type: 'order.status.changed',
      payload: {
        order: { id: '14', status: 'preparing' },
        newStatus: 'preparing',
        previousStatus: 'pending'
      }
    };
    
    // Run handler
    await handler(event);
    
    // Verification: findUnique was called with parsed order ID 14
    expect(mockPrisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 14 }
      })
    );
    
    // Verification: _generateStatusContent was called with orderContext and resolvedStatus 'preparing'
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 14 }),
      'preparing'
    );
  });
});
