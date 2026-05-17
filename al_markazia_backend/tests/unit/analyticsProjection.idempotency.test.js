const analytics = require('../../src/projections/analyticsProjection');

// Mock external dependencies
jest.mock('../../src/lib/prisma', () => ({
  order: {
    findMany: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../../src/socket', () => ({
  isReady: () => false
}));

describe('analyticsProjection - Idempotency Guard & Memory Cleanup', () => {
  beforeEach(() => {
    analytics.reset();
  });

  test('Requirement: handleStatusChange rejects stale replayed events with older versions', async () => {
    const mockOrderV2 = {
      id: 555,
      branchId: 'branch-amman-1',
      status: 'delivered',
      orderType: 'delivery',
      version: 2
    };

    const mockOrderV1 = {
      id: 555,
      branchId: 'branch-amman-1',
      status: 'preparing',
      orderType: 'delivery',
      version: 1
    };

    // Apply the newer version first (e.g. out-of-order delivery/network lag)
    await analytics.handleStatusChange({ order: mockOrderV2 });

    const metricsAfterV2 = analytics.getMetrics('branch-amman-1');
    expect(metricsAfterV2.statusDistribution.delivered).toBe(1);
    expect(metricsAfterV2.statusDistribution.preparing).toBe(0);

    // Now apply the older version 1 (which should be safely discarded)
    await analytics.handleStatusChange({ order: mockOrderV1 });

    const metricsAfterV1 = analytics.getMetrics('branch-amman-1');
    // Ensure status is NOT reverted to preparing, and remains delivered
    expect(metricsAfterV1.statusDistribution.delivered).toBe(1);
    expect(metricsAfterV1.statusDistribution.preparing).toBe(0);
  });

  test('Requirement: periodicCleanup deletes entries older than 24 hours from the active map', async () => {
    const mockOrder = {
      id: 777,
      branchId: 'branch-amman-1',
      status: 'pending',
      orderType: 'takeaway',
      version: 1
    };

    // Add entry
    analytics.handleCreated({ order: mockOrder });

    // Mock Date.now() to simulate 25 hours later
    const originalNow = Date.now;
    const futureTime = originalNow() + (25 * 60 * 60 * 1000);
    global.Date.now = jest.fn(() => futureTime);

    try {
      // Run cleanup
      analytics.periodicCleanup();

      // Trigger metrics rebuild - since the entry is deleted, count should drop to 0!
      // (Normally handleModified or handleStatusChange would trigger this, or we can see if it was deleted)
      const metrics = analytics.getMetrics('branch-amman-1');
      
      // Let's reset the map to verify it is empty by asserting that re-calculating results in 0
      // We can trigger it by sending a modified event for another order and checking metrics
      await analytics.handleStatusChange({
        order: { id: 888, branchId: 'branch-amman-1', status: 'pending', version: 1 }
      });

      const updatedMetrics = analytics.getMetrics('branch-amman-1');
      // The old 777 order is removed, so only the new 888 order should be counted!
      expect(updatedMetrics.statusDistribution.pending).toBe(1); // 777 is NOT included!
    } finally {
      global.Date.now = originalNow;
    }
  });
});
