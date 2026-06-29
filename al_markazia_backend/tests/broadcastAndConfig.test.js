const { NotificationService } = require('../src/services/notificationService');

// Mock container
const container = {
  prisma: {
    notificationLog: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    }
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
};

describe('FCM Broadcast and Reconciler Tests', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(container);
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

    container.prisma.notificationLog.findMany.mockResolvedValue([broadcastNotif]);
    
    // Spy on dispatch
    const dispatchSpy = jest.spyOn(service, 'dispatch').mockResolvedValue();

    await service.reconcile();

    // Verification: dispatch was called with the broadcast notification and placeholder order context
    expect(dispatchSpy).toHaveBeenCalledWith(broadcastNotif, { id: 0 });
    // It should not call update immediately with SENT in the loop (except through dispatch itself)
    expect(container.prisma.notificationLog.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: { status: 'SENT' }
      })
    );
  });
});
