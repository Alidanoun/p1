const { runDailyArchiver } = require('../src/jobs/dailyArchiver');
const prisma = require('../src/lib/prisma');
const { runAsSystemAdmin } = require('../src/utils/context');

// Use timestamp-based unique codes to avoid unique constraint conflicts on reruns
const RUN_ID = Date.now();

describe('RLS Integration - Background Jobs', () => {
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
      return;
    }
    await runAsSystemAdmin(async () => {
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
  });

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
});
