jest.mock('../../src/lib/prisma', () => ({
  order: {
    findMany: jest.fn()
  },
  financialLedger: {
    findMany: jest.fn()
  }
}));

const systemValidator = require('../../src/services/systemValidator');
const prisma = require('../../src/lib/prisma');

describe('SystemValidator - N+1 Query Fix & Refund Integrity (Mocked)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Requirement: validateCancellations loads refunds in a SINGLE query batch (No N+1)', async () => {
    const mockOrders = Array.from({ length: 10 }).map((_, index) => ({
      id: index + 1,
      orderNumber: `N1-ORD-${index}`,
      branchId: 'test-branch-id',
      total: 50.00
    }));

    // Mock 8 COMPLETED credit refund ledgers (2 orders have missing refunds)
    const mockRefunds = Array.from({ length: 8 }).map((_, index) => ({
      orderId: index + 1,
      amount: 50.00,
      status: 'COMPLETED'
    }));

    prisma.order.findMany.mockResolvedValue(mockOrders);
    prisma.financialLedger.findMany.mockResolvedValue(mockRefunds);

    const issues = await systemValidator.validateCancellations(Date.now() - 24*60*60*1000);

    // Verify findMany was called only ONCE for order and ONCE for ledgers (No N+1)
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.financialLedger.findMany).toHaveBeenCalledTimes(1);

    // Verify correct issues detected (orders 9 and 10 have missing refunds)
    const missingRefunds = issues.filter(i => i.issue === 'MISSING_REFUND');
    expect(missingRefunds.length).toBe(2);
    expect(missingRefunds[0].orderId).toBe(9);
    expect(missingRefunds[1].orderId).toBe(10);
  });

  test('Requirement: validateCancellations detects REFUND_AMOUNT_MISMATCH', async () => {
    const mockOrders = [
      { id: 1, orderNumber: 'N1-ORD-MISMATCH', branchId: 'test-branch-id', total: 100.00 }
    ];

    const mockRefunds = [
      { orderId: 1, amount: 80.00, status: 'COMPLETED' } // Mismatch: expected 100, got 80
    ];

    prisma.order.findMany.mockResolvedValue(mockOrders);
    prisma.financialLedger.findMany.mockResolvedValue(mockRefunds);

    const issues = await systemValidator.validateCancellations(Date.now() - 24*60*60*1000);

    // Verify correct issue detected
    const mismatchIssue = issues.find(i => i.orderId === 1 && i.issue === 'REFUND_AMOUNT_MISMATCH');
    expect(mismatchIssue).toBeTruthy();
    expect(mismatchIssue.expected).toBe(100.00);
    expect(mismatchIssue.actual).toBe(80.00);
  });

  test('Requirement: validateCancellationsPaginated processes datasets successfully using pagination batches', async () => {
    // Page 1: returns 2 orders
    // Page 2: returns empty array (ends loop)
    prisma.order.findMany
      .mockResolvedValueOnce([
        { id: 1, orderNumber: 'N1-ORD-P1', branchId: 'test-branch-id', total: 50.00 },
        { id: 2, orderNumber: 'N1-ORD-P2', branchId: 'test-branch-id', total: 50.00 }
      ])
      .mockResolvedValueOnce([]); // Ends loop

    prisma.financialLedger.findMany.mockResolvedValue([
      { orderId: 1, amount: 50.00, status: 'COMPLETED' } // Order 2 is missing refund
    ]);

    const issues = await systemValidator.validateCancellationsPaginated(Date.now() - 24*60*60*1000, 2);

    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.financialLedger.findMany).toHaveBeenCalledTimes(1);

    const missingRefunds = issues.filter(i => i.issue === 'MISSING_REFUND');
    expect(missingRefunds.length).toBe(1);
    expect(missingRefunds[0].orderId).toBe(2);
  });
});
