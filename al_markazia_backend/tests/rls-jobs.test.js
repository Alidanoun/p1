const { runDailyArchiver } = require('../src/jobs/dailyArchiver');
const prisma = require('../src/lib/prisma');
const { runAsSystemAdmin } = require('../src/utils/context');

// Use timestamp-based unique codes to avoid unique constraint conflicts on reruns
const RUN_ID = Date.now();

describe('RLS Integration - Background Jobs', () => {
  jest.setTimeout(30000); // 30 seconds timeout to handle background jobs and slow CI

  let branchA, branchB, customer;

  beforeAll(async () => {
    // All setup done via runAsSystemAdmin because orders are RLS-protected
    await runAsSystemAdmin(async () => {
      // Create specific test branches with unique codes per test run
      branchA = await prisma.branch.create({
        data: { name: `Test Branch A ${RUN_ID}`, code: `TEST-A-${RUN_ID}` }
      });

      branchB = await prisma.branch.create({
        data: { name: `Test Branch B ${RUN_ID}`, code: `TEST-B-${RUN_ID}` }
      });

      // Create a dummy customer with unique phone per run
      customer = await prisma.customer.create({
        data: {
          phone: `079${RUN_ID}`.slice(0, 11),
          name: 'RLS Test Customer',
          password: 'hash'
        }
      });

      // Create delivered orders for both branches
      await prisma.order.create({
        data: {
          branchId: branchA.id,
          customerId: customer.id,
          orderNumber: `RLS-A-${RUN_ID}`,
          customerName: 'RLS Test Customer',
          customerPhone: '07999999999',
          status: 'delivered',
          total: 10,
          subtotal: 10,
          tax: 0,
          deliveryFee: 0,
          orderType: 'pickup'
        }
      });

      await prisma.order.create({
        data: {
          branchId: branchB.id,
          customerId: customer.id,
          orderNumber: `RLS-B-${RUN_ID}`,
          customerName: 'RLS Test Customer',
          customerPhone: '07999999999',
          status: 'delivered',
          total: 20,
          subtotal: 20,
          tax: 0,
          deliveryFee: 0,
          orderType: 'pickup'
        }
      });
    });
  });

  afterAll(async () => {
    if (!branchA || !branchB) {
      await prisma.$disconnect();
      await redis.quitAll();
      return;
    }
    await runAsSystemAdmin(async () => {
      const orders = await prisma.order.findMany({ where: { branchId: { in: [branchA.id, branchB.id] } }, select: { id: true } });
      const orderIds = orders.map(o => o.id);
      if (orderIds.length > 0) {
        await prisma.orderCancellation.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderAuditLog.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      await prisma.order.deleteMany({
        where: { branchId: { in: [branchA.id, branchB.id] } }
      });
      await prisma.dailyFinancialSnapshot.deleteMany({
        where: { branchId: { in: [branchA.id, branchB.id] } }
      });
      await prisma.dailyReport.deleteMany({
        where: { branchId: { in: [branchA.id, branchB.id] } }
      });
      if (customer) {
        await prisma.customer.delete({ where: { id: customer.id } });
      }
      await prisma.branch.delete({ where: { id: branchA.id } });
      await prisma.branch.delete({ where: { id: branchB.id } });
    });
    await prisma.$disconnect();
    if (typeof redis.quitAll === 'function') {
      await redis.quitAll();
    } else {
      await redis.quit();
    }
  }, 30000);

  it('should run dailyArchiver without throwing RLS Zero-Trust errors and respect branch isolation', async () => {
    // If runDailyArchiver throws an RLS error, this test will fail.
    await expect(runDailyArchiver(branchA.id)).resolves.not.toThrow();

    // Verify branch isolation: only branch A's orders were archived
    const archivedOrdersA = await runAsSystemAdmin(async () => prisma.order.findMany({
      where: { branchId: branchA.id, isArchived: true }
    }));
    expect(archivedOrdersA.length).toBe(1);

    const unarchivedOrdersB = await runAsSystemAdmin(async () => prisma.order.findMany({
      where: { branchId: branchB.id, isArchived: false }
    }));
    expect(unarchivedOrdersB.length).toBe(1); // Branch B should NOT be archived
  });

  it('should run dailyArchiver without targetBranchId, processing all branches and isolating contexts', async () => {
    // Reset orders back to unarchived state for both branches to test the full path
    await runAsSystemAdmin(async () => {
      await prisma.order.updateMany({
        where: { branchId: { in: [branchA.id, branchB.id] } },
        data: { isArchived: false }
      });
    });

    // Run without targetBranchId (entire multi-branch loop)
    await expect(runDailyArchiver()).resolves.not.toThrow();

    // Verify both branch A and branch B orders are archived
    const archivedOrders = await runAsSystemAdmin(async () => prisma.order.findMany({
      where: { branchId: { in: [branchA.id, branchB.id] }, isArchived: true }
    }));
    expect(archivedOrders.length).toBe(2);
  }, 30000);

  it('should execute ContractGateway system actions in background contexts without throwing RLS Zero-Trust errors', async () => {
    const container = require('../src/lib/container');
    const contractGateway = container.contractGateway;

    // Create a new unarchived delivered order for branch A
    let order;
    await runAsSystemAdmin(async () => {
      order = await prisma.order.create({
        data: {
          branchId: branchA.id,
          customerId: customer.id,
          orderNumber: `RLS-GW-${RUN_ID}`,
          customerName: 'RLS Test Customer',
          customerPhone: '07999999999',
          status: 'pending',
          total: 15,
          subtotal: 15,
          tax: 0,
          deliveryFee: 0,
          orderType: 'pickup'
        }
      });
    });

    // Execute order cancellation via ContractGateway.
    // This executes as 'SYSTEM' actor, simulating background lifecycle queues (no manual AsyncLocalStorage context set here).
    const systemActor = { id: 'SYSTEM', role: 'system' };
    const cancelContext = {
      reason: 'AUTO_TIMEOUT: Test system cancellation',
      idempotencyKey: `timeout_test_${order.id}_${Date.now()}`
    };

    await expect(
      contractGateway.execute(order.id, 'SYSTEM_CANCEL', cancelContext, systemActor)
    ).resolves.not.toThrow();

    // Verify order was indeed cancelled
    const updatedOrder = await runAsSystemAdmin(async () => prisma.order.findUnique({
      where: { id: order.id }
    }));
    expect(updatedOrder.status).toBe('cancelled');
  });
});
