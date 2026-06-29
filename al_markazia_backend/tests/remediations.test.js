const prisma = require('../src/lib/prisma');
const redis = require('../src/lib/redis');
const reportController = require('../src/controllers/reportController');
const reviewController = require('../src/controllers/reviewController');
const adminModerationController = require('../src/controllers/adminModerationController');
const financialApprovalController = require('../src/controllers/financialApprovalController');
const financialApprovalService = require('../src/services/financialApprovalService');
const notificationController = require('../src/controllers/notificationController');

jest.mock('../src/lib/prisma', () => ({
  orderItem: {
    groupBy: jest.fn()
  },
  order: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn()
  },
  review: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn()
  },
  reply: {
    create: jest.fn()
  },
  financialApproval: {
    count: jest.fn()
  },
  notificationLog: {
    findMany: jest.fn()
  },
  branch: {
    findMany: jest.fn()
  },
  dailyReport: {
    upsert: jest.fn()
  }
}));

jest.mock('../src/lib/redis', () => ({
  set: jest.fn(),
  del: jest.fn()
}));

jest.mock('../src/services/ratingAggregate', () => ({
  updateFromReview: jest.fn()
}));

jest.mock('../src/services/notificationService', () => ({
  sendDirectNotification: jest.fn()
}));

describe('Remediations Verification Tests', () => {
  let mockReq, mockRes;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      user: { id: 'test-user-uuid', role: 'branch_manager', branchId: 'branch-1' },
      query: {},
      body: {},
      params: {},
      authoritativeBranchId: 'branch-1'
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  // 1. Daily Reports Top Items Isolation
  test('Item 1: getTopItems should filter orders by branchId if manager context is present', async () => {
    prisma.orderItem.groupBy.mockResolvedValue([]);

    await reportController.getTopItems(mockReq, mockRes);

    expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: expect.objectContaining({
            branchId: 'branch-1'
          })
        })
      })
    );
    expect(mockRes.json).toHaveBeenCalled();
  });

  // 2. Reviews Moderation toggleApproval Mismatch Manger
  test('Item 2: toggleApproval (item review) should reject request if review branchId does not match manager branchId', async () => {
    mockReq.params.id = '123';
    mockReq.body.isApproved = true;

    prisma.review.findUnique.mockResolvedValue({ id: 123, branchId: 'branch-different' });

    await reviewController.toggleApproval(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ACCESS_DENIED' }));
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  test('Item 2: toggleApproval (order rating) should reject request if order branchId does not match manager branchId', async () => {
    mockReq.params.id = 'order-123';
    mockReq.body.isApproved = true;

    prisma.order.findUnique.mockResolvedValue({ id: 123, branchId: 'branch-different' });

    await reviewController.toggleApproval(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ACCESS_DENIED' }));
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  test('Item 2: deleteReview should reject request if review branchId does not match manager branchId', async () => {
    mockReq.params.id = '123';

    prisma.review.findUnique.mockResolvedValue({ id: 123, branchId: 'branch-different' });

    await reviewController.deleteReview(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ACCESS_DENIED' }));
    expect(prisma.review.delete).not.toHaveBeenCalled();
  });

  test('Item 2: adminModerationController.updateStatus should reject request if review branchId does not match manager branchId', async () => {
    mockReq.params.id = '123';
    mockReq.body.status = 'APPROVED';

    prisma.review.findUnique.mockResolvedValue({ id: 123, branchId: 'branch-different' });

    await adminModerationController.updateStatus(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'ACCESS_DENIED' }));
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  test('Item 2: adminModerationController.postReply should reject request if review branchId does not match manager branchId', async () => {
    mockReq.params.id = '123';
    mockReq.body.content = 'Thank you!';

    prisma.review.findUnique.mockResolvedValue({ id: 123, branchId: 'branch-different' });

    await adminModerationController.postReply(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'ACCESS_DENIED' }));
    expect(prisma.reply.create).not.toHaveBeenCalled();
  });

  // 3. EOD Archiver Lock
  test('Item 4: dailyArchiver should acquire Redis lock and release it', async () => {
    const { runDailyArchiver } = require('../src/jobs/dailyArchiver');
    redis.set.mockResolvedValue('locked');
    prisma.branch.findMany.mockResolvedValue([]);

    await runDailyArchiver();

    expect(redis.set).toHaveBeenCalledWith('lock:job:daily_archiver', 'locked', 'NX', 'EX', 600);
    expect(redis.del).toHaveBeenCalledWith('lock:job:daily_archiver');
  });

  // 4. Financial Approval Stats Scoped
  test('Item 7: getApprovalStats should filter counts by branchId if manager context is present', async () => {
    prisma.financialApproval.count.mockResolvedValue(0);

    await financialApprovalController.getApprovalStats(mockReq, mockRes);

    expect(prisma.financialApproval.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: 'branch-1'
        })
      })
    );
    expect(mockRes.json).toHaveBeenCalled();
  });

  // 5. Global Administrative Notifications Scoped
  test('Item 8: getAdminNotifications should filter notifications by orders from manager branch', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 10 }, { id: 20 }]);
    prisma.notificationLog.findMany.mockResolvedValue([]);

    await notificationController.getAdminNotifications(mockReq, mockRes);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: 'branch-1'
        })
      })
    );
    expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { orderId: { in: [10, 20] } },
            { orderId: null }
          ]
        })
      })
    );
  });
});
