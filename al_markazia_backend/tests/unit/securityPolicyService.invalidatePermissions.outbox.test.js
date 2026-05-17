const { SecurityPolicyService } = require('../../src/services/securityPolicyService');

describe('SecurityPolicyService - Invalidate Permissions Transactional Outbox Integration', () => {
  let service;
  let prismaMock;
  let redisMock;
  let loggerMock;
  let containerMock;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      user: {
        update: jest.fn()
      },
      customer: {
        update: jest.fn()
      },
      $transaction: jest.fn(async (cb) => {
        return await cb(prismaMock);
      })
    };

    redisMock = {
      del: jest.fn().mockResolvedValue(1)
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
      outboxService: {
        enqueue: jest.fn().mockResolvedValue({ id: 'outbox-uuid-456' }),
        immediateDispatch: jest.fn().mockResolvedValue(),
        pulse: jest.fn().mockResolvedValue()
      }
    };

    // Mock getContainer to return containerMock
    jest.spyOn(require('../../src/lib/container'), 'outboxService', 'get').mockReturnValue(containerMock.outboxService);

    service = new SecurityPolicyService({
      prisma: prismaMock,
      redis: redisMock,
      logger: loggerMock
    });
  });

  test('Requirement: invalidateUserPermissions wraps DB update and outbox enqueue in transaction, then clears cache and dispatches event', async () => {
    const mockUserId = 'user-uuid-111-222-333';

    // Mock Prisma update to succeed for User
    prismaMock.user.update.mockResolvedValue({ id: 1, role: 'admin' });

    const result = await service.invalidateUserPermissions(mockUserId);

    // Verify it succeeded
    expect(result).toBe(true);

    // Verify transaction block was executed
    expect(prismaMock.$transaction).toHaveBeenCalled();

    // Verify DB update happened inside transaction using transaction client tx
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { uuid: mockUserId },
      data: { permissionVersion: { increment: 1 } },
      select: { id: true, role: true }
    });

    // Verify outbox event enqueued atomically
    expect(containerMock.outboxService.enqueue).toHaveBeenCalledWith(
      prismaMock, // Passes the transaction client (tx)
      expect.objectContaining({
        type: 'USER_PERMISSIONS_CHANGED',
        aggregateId: mockUserId,
        aggregateType: 'User',
        payload: expect.objectContaining({
          userId: mockUserId,
          reason: 'ADMIN_ACTION'
        })
      })
    );

    // Verify Redis cache key `user:branches:${userId}` was deleted post-commit
    expect(redisMock.del).toHaveBeenCalledWith(`user:branches:${mockUserId}`);

    // Verify immediate dispatch was called for the outbox event ID
    expect(containerMock.outboxService.immediateDispatch).toHaveBeenCalledWith('outbox-uuid-456');

    // Verify outbox pulse is triggered asynchronously
    await new Promise(setImmediate);
    expect(containerMock.outboxService.pulse).toHaveBeenCalled();
  });
});
