const { OrderStateMachine } = require('../../src/domain/orderStateMachine');
const { ContractGateway } = require('../../src/services/contractGateway');
const CancellationOrchestrator = require('../../src/services/cancellationOrchestrator');
const logger = require('../../src/utils/logger');

jest.mock('../../src/utils/logger', () => ({
  debug: jest.fn(),
  security: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

describe('Order Cancellation Hardening & Force Cancel', () => {
  let mockPrisma;
  let mockRedis;
  let mockContainer;
  let orderStateMachine;
  let cancellationOrchestrator;
  let contractGateway;

  beforeEach(() => {
    orderStateMachine = new OrderStateMachine(logger);

    mockPrisma = {
      order: {
        findUnique: jest.fn()
      }
    };

    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn()
    };

    mockContainer = {
      prisma: mockPrisma,
      redis: mockRedis,
      logger,
      orderStateMachine,
      systemControlPlane: {
        getHealthStatus: jest.fn().mockResolvedValue({ status: 'HEALTHY' })
      },
      idempotencyService: {
        start: jest.fn().mockResolvedValue({ status: 'NEW' }),
        commit: jest.fn(),
        rollback: jest.fn()
      },
      circuitBreakerService: {
        isOpen: jest.fn().mockResolvedValue(false),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn()
      },
      securityPolicyService: {
        canAccessBranch: jest.fn().mockResolvedValue(true)
      }
    };

    cancellationOrchestrator = new CancellationOrchestrator(mockContainer);
    mockContainer.cancellationOrchestrator = cancellationOrchestrator;

    contractGateway = new ContractGateway(mockContainer);
    mockContainer.contractGateway = contractGateway;
  });

  describe('Policy Evaluation in CancellationOrchestrator', () => {
    test('should reject cancellation if order is already delivered', async () => {
      const order = { status: 'delivered', id: 101 };
      const actor = { role: 'customer', id: 'cust-1' };
      
      const policy = await cancellationOrchestrator._evaluatePolicy(order, actor, 'CUSTOMER_CANCEL');
      expect(policy.action).toBe('REJECT');
      expect(policy.reason).toBe('order_already_delivered');
    });

    test('should reject cancellation if order is already cancelled', async () => {
      const order = { status: 'cancelled', id: 101 };
      const actor = { role: 'customer', id: 'cust-1' };
      
      const policy = await cancellationOrchestrator._evaluatePolicy(order, actor, 'CUSTOMER_CANCEL');
      expect(policy.action).toBe('REJECT');
      expect(policy.reason).toBe('order_already_cancelled');
    });

    test('should allow cancellation if order is delivered but source is ADMIN_FORCE_CANCEL', async () => {
      const order = { status: 'delivered', id: 101 };
      const actor = { role: 'admin', id: 'admin-1' };
      
      const policy = await cancellationOrchestrator._evaluatePolicy(order, actor, 'ADMIN_FORCE_CANCEL');
      expect(policy.action).toBe('EXECUTE');
    });
  });

  describe('Contract Validation in ContractGateway', () => {
    test('should throw illegal transition error when trying to CANCEL a delivered order', async () => {
      const actor = { role: 'customer', id: 'cust-1' };
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 101,
        status: 'delivered',
        branchId: 'branch-1'
      });

      // Override getBranchId to match context
      const context = require('../../src/utils/context');
      jest.spyOn(context, 'getBranchId').mockReturnValue('branch-1');

      await expect(
        contractGateway._validateContract('CANCEL', { idempotencyKey: 'test-key', reason: 'Cancellation reason' }, 101, actor)
      ).rejects.toThrow(/ILLEGAL_TRANSITION/);
    });

    test('should pass validation when trying to FORCE_CANCEL a delivered order (no state check constraint)', async () => {
      const actor = { role: 'admin', id: 'admin-1' };
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 101,
        status: 'delivered',
        branchId: 'branch-1'
      });

      const context = require('../../src/utils/context');
      jest.spyOn(context, 'getBranchId').mockReturnValue('branch-1');

      // Should not throw any error since FORCE_CANCEL skips standard validate check
      await expect(
        contractGateway._validateContract('FORCE_CANCEL', { idempotencyKey: 'test-key', reason: 'Force cancellation reason' }, 101, actor)
      ).resolves.not.toThrow();
    });
  });
});
