const socketModule = require('../../src/socket');
const SecurityPolicyService = require('../../src/services/securityPolicyService');

// Mock all external modules to prevent boots/network calls
jest.mock('socket.io', () => {
  return {
    Server: jest.fn().mockImplementation(() => {
      return {
        adapter: jest.fn(),
        use: jest.fn(),
        on: jest.fn(),
        fetchSockets: jest.fn().mockResolvedValue([])
      };
    })
  };
});
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }));
jest.mock('../../src/lib/redis', () => ({ publisher: {}, socketSubscriber: {} }));
jest.mock('../../src/services/securityPolicyService');
jest.mock('../../src/services/tokenService');

// Mock prisma to return valid user and order details for sync:full to pass
jest.mock('../../src/lib/prisma', () => ({
  user: {
    findUnique: jest.fn().mockResolvedValue({
      id: 'db-id-888',
      role: 'BRANCH_MANAGER',
      branchId: 'branch-1',
      isActive: true
    })
  },
  order: {
    findMany: jest.fn().mockResolvedValue([])
  }
}));

// Robust Mock for auditService proxy and class
jest.mock('../../src/services/auditService', () => {
  const mockAuditServiceInstance = {
    log: jest.fn().mockResolvedValue({}),
    logBranchSwitch: jest.fn().mockResolvedValue({}),
    setupSubscriber: jest.fn(),
    destroy: jest.fn()
  };
  const mockProxy = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'AuditService') {
        return jest.fn().mockImplementation(() => mockAuditServiceInstance);
      }
      return mockAuditServiceInstance[prop] || jest.fn();
    }
  });
  mockProxy.AuditService = jest.fn().mockImplementation(() => mockAuditServiceInstance);
  return mockProxy;
});

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: () => ({
      spanContext: () => ({ traceId: 'trace-123' })
    })
  }
}));

describe('Socket.io - Transition Guard and Sync Debounce', () => {
  let connectionCallback;
  let mockSocket;
  let mockServerInstance;
  let syncFullCallback;

  beforeEach(async () => {
    jest.clearAllMocks();

    const { Server } = require('socket.io');
    mockServerInstance = new Server();
    Server.mockImplementation(() => mockServerInstance);

    // Capture the 'connection' callback
    mockServerInstance.on.mockImplementation((event, cb) => {
      if (event === 'connection') {
        connectionCallback = cb;
      }
    });

    // Run init to register everything
    socketModule.init({ on: jest.fn() });

    mockSocket = {
      id: 'socket-client-999',
      handshake: {
        address: '127.0.0.1',
        headers: { 'user-agent': 'Jest' }
      },
      user: {
        id: 'user-uuid-888',
        role: 'branch_manager',
        branchId: 'branch-1'
      },
      data: {
        authRooms: new Set(),
        leaseExpiresAt: Date.now() + 60000
      },
      join: jest.fn(),
      leave: jest.fn(),
      use: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
      rooms: new Set(['socket-client-999'])
    };

    // Capture inner listeners by monitoring mockSocket.on calls during connection
    mockSocket.on.mockImplementation((event, cb) => {
      if (event === 'sync:full') {
        syncFullCallback = cb;
      }
    });

    SecurityPolicyService.getTargetRooms.mockResolvedValue(['room:exec:branch-1']);
    SecurityPolicyService.checkUserStatus.mockResolvedValue({ isActive: true, isBlacklisted: false });

    await connectionCallback(mockSocket);
  });

  test('Requirement: recalculateRooms serializes calls using transitionId to drop stale executions', async () => {
    // Trigger recalculateRooms Call 1
    let resolveCall1, resolveCall2;
    const promise1 = new Promise(resolve => { resolveCall1 = resolve; });
    const promise2 = new Promise(resolve => { resolveCall2 = resolve; });

    SecurityPolicyService.getTargetRooms
      .mockImplementationOnce(() => promise1)
      .mockImplementationOnce(() => promise2);

    const run1 = mockSocket.recalculateRooms();
    
    // Wait a tick for run1's checkUserStatus to resolve and proceed to getTargetRooms
    await new Promise(setImmediate);

    // Trigger recalculateRooms Call 2 (stamps transitionId = 2)
    const run2 = mockSocket.recalculateRooms();
    
    // Wait a tick for run2's checkUserStatus to resolve and proceed to getTargetRooms
    await new Promise(setImmediate);

    // Verify transitionId incremented to 2
    expect(mockSocket.data.transitionId).toBe(2);

    // Resolve the first call with stale rooms (should be discarded safely)
    resolveCall1(['room:exec:branch-old']);
    await run1;

    // Resolve the second call with fresh rooms (should be applied)
    resolveCall2(['room:exec:branch-new']);
    await run2;

    // Verify join was called for the new room, not the old room
    expect(mockSocket.join).toHaveBeenCalledWith('room:exec:branch-new');
    expect(mockSocket.join).not.toHaveBeenCalledWith('room:exec:branch-old');
  });

  test('Requirement: sync:full debounces calls if recalculation is already in progress', async () => {
    // Simulate that recalculation is in progress
    mockSocket.data.recalcInProgress = true;

    const ackMock = jest.fn();

    // Trigger sync:full
    const syncPromise = syncFullCallback(ackMock);

    // Verify it waits and does not immediately proceed or ack
    expect(ackMock).not.toHaveBeenCalled();

    // Simulate recalculation completes after a short delay
    setTimeout(() => {
      mockSocket.data.recalcInProgress = false;
    }, 50);

    await syncPromise;

    // Verify it proceeds and acks eventually after recalculation completes
    expect(ackMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
