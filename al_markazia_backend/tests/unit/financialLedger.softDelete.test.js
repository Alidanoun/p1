const prisma = require('../../src/lib/prisma');

describe('FinancialLedger - Soft Delete & Cascading Restrict Constraints', () => {
  let testBranch;
  let testLedger;

  beforeAll(async () => {
    // 1. Create a clean test branch
    testBranch = await prisma.branch.create({
      data: {
        name: 'Test Branch for Soft Delete',
        code: `TST-BRANCH-${Math.random().toString(36).substring(7).toUpperCase()}`,
        isActive: true
      }
    });
  });

  afterAll(async () => {
    // Clean up created entities (bypass soft delete to delete physically)
    if (testLedger) {
      await prisma.financialLedger.deleteMany({
        where: { branchId: testBranch.id }
      });
    }
    if (testBranch) {
      await prisma.branch.delete({
        where: { id: testBranch.id }
      });
    }
  });

  test('Requirement: Standard queries do NOT return soft-deleted records', async () => {
    // Create a new Financial Ledger entry
    testLedger = await prisma.financialLedger.create({
      data: {
        branchId: testBranch.id,
        type: 'CREDIT',
        category: 'ORDER_PAYMENT',
        amount: 150.00,
        balanceBefore: 0.00,
        balanceAfter: 150.00,
        method: 'CASH',
        description: 'Test transaction ledger entry'
      }
    });

    // Verify it is visible by default
    let found = await prisma.financialLedger.findFirst({
      where: { id: testLedger.id }
    });
    expect(found).toBeTruthy();
    expect(found.isDeleted).toBe(false);

    // Soft delete by updating isDeleted: true
    await prisma.financialLedger.update({
      where: { id: testLedger.id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: 'admin-test-uid'
      }
    });

    // Standard query must NOT see it (it should return null because of our prisma query extension)
    found = await prisma.financialLedger.findFirst({
      where: { id: testLedger.id }
    });
    expect(found).toBeNull();

    // Standard findMany must NOT see it
    const list = await prisma.financialLedger.findMany({
      where: { id: testLedger.id }
    });
    expect(list.length).toBe(0);

    // Bypassing soft delete filter using skipSoftDelete should successfully return the record
    const adminView = await prisma.financialLedger.findFirst({
      where: { id: testLedger.id },
      skipSoftDelete: true
    });
    expect(adminView).toBeTruthy();
    expect(adminView.isDeleted).toBe(true);
    expect(adminView.deletedBy).toBe('admin-test-uid');
  });

  test('Requirement: Deleting a Branch that has financial ledger entries is restricted by foreign key', async () => {
    // Attempting to physically delete the branch must fail with a foreign key restrict violation
    await expect(
      prisma.branch.delete({
        where: { id: testBranch.id }
      })
    ).rejects.toThrow();
  });
});
