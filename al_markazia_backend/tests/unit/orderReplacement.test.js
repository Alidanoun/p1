// Mock ioredis before anything else loads it
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      duplicate: jest.fn().mockReturnThis(),
      options: { db: 0 }
    };
  });
});

const { OrderService } = require('../../src/services/orderService');

// Mock dependencies
jest.mock('../../src/services/configService', () => ({
  getFullConfig: jest.fn(() => Promise.resolve({
    business: {
      taxRate: 0.16
    }
  }))
}));

jest.mock('../../src/queues/orderQueue', () => ({
  orderQueue: {
    add: jest.fn(() => Promise.resolve())
  }
}));

describe('OrderService - Item Replacement & Cancellation Compensation', () => {
  let service;
  let prismaMock;
  let loggerMock;
  let notificationServiceMock;
  let containerMock;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      orderItem: {
        update: jest.fn(),
        create: jest.fn()
      },
      item: {
        findUnique: jest.fn()
      },
      couponRequest: {
        findFirst: jest.fn(),
        create: jest.fn()
      },
      orderAuditLog: {
        create: jest.fn()
      },
      $transaction: jest.fn(async (cb) => {
        return await cb(prismaMock);
      })
    };

    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };

    notificationServiceMock = {
      sendToUser: jest.fn(() => Promise.resolve())
    };

    containerMock = {
      prisma: prismaMock,
      logger: loggerMock,
      notificationService: notificationServiceMock
    };

    service = new OrderService(containerMock);
  });

  describe('suggestReplacement', () => {
    test('successfully suggests a replacement and schedules a timeout job', async () => {
      const orderId = 123;
      const itemId = 456;
      const alternativeItemId = 789;
      const actor = { id: 10, role: 'branch_manager', uuid: 'branch-mgr-uuid' };

      const mockOrder = {
        id: orderId,
        branchId: 'branch-1',
        customerId: 100,
        orderItems: [
          { id: itemId, itemId: 111, itemName: 'Burger', unitPrice: 5.0, quantity: 1, status: 'normal' }
        ]
      };

      const mockAlternativeItem = {
        id: alternativeItemId,
        title: 'Veggie Burger',
        isAvailable: true,
        branchItems: [
          { branchId: 'branch-1', isAvailable: true }
        ]
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder);
      prismaMock.item.findUnique.mockResolvedValue(mockAlternativeItem);
      prismaMock.orderItem.update.mockResolvedValue({
        id: itemId,
        status: 'pending_replacement_approval',
        suggestedReplacementItemId: alternativeItemId,
        replacementStatus: 'PENDING'
      });

      const result = await service.suggestReplacement(orderId, itemId, alternativeItemId, actor);

      expect(result.success).toBe(true);
      expect(result.orderItem.status).toBe('pending_replacement_approval');

      // Verify Prisma updates
      expect(prismaMock.orderItem.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: {
          status: 'pending_replacement_approval',
          suggestedReplacementItemId: alternativeItemId,
          replacementStatus: 'PENDING'
        }
      });

      // Verify BullMQ job is scheduled
      const { orderQueue } = require('../../src/queues/orderQueue');
      expect(orderQueue.add).toHaveBeenCalledWith(
        'replacement-timeout',
        { orderId, itemId, type: 'replacement-timeout' },
        { delay: 15 * 60 * 1000 }
      );

      // Verify notification sent to customer
      expect(notificationServiceMock.sendToUser).toHaveBeenCalledWith(100, expect.objectContaining({
        title: 'مقترح استبدال صنف 🔄',
        type: 'replacement_suggested',
        orderId
      }));
    });

    test('throws error if order is not found', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(
        service.suggestReplacement(123, 456, 789, { role: 'branch_manager' })
      ).rejects.toThrow('ORDER_NOT_FOUND');
    });

    test('throws error if item to replace does not have normal status', async () => {
      const mockOrder = {
        id: 123,
        orderItems: [
          { id: 456, status: 'cancelled' }
        ]
      };
      prismaMock.order.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.suggestReplacement(123, 456, 789, { role: 'branch_manager' })
      ).rejects.toThrow('INVALID_ITEM_STATUS');
    });
  });

  describe('respondReplacement', () => {
    test('successfully accepts replacement and recalculates totals', async () => {
      const orderId = 123;
      const itemId = 456;
      const alternativeItemId = 789;
      const actor = { id: 100, role: 'customer', uuid: 'cust-uuid' };

      const mockOrder = {
        id: orderId,
        orderNumber: 'ORD-001',
        branchId: 'branch-1',
        customerId: 100,
        deliveryFee: '2.00',
        discount: '0.00',
        total: '7.80',
        subtotal: '5.00',
        tax: '0.80',
        version: 1,
        orderItems: [
          {
            id: itemId,
            itemId: 111,
            itemName: 'Burger',
            unitPrice: 5.0,
            quantity: 1,
            status: 'pending_replacement_approval',
            suggestedReplacementItemId: alternativeItemId
          }
        ]
      };

      const mockAlternativeItem = {
        id: alternativeItemId,
        title: 'Veggie Burger',
        titleEn: 'Veggie Burger En',
        basePrice: 6.0
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder);
      prismaMock.item.findUnique.mockResolvedValue(mockAlternativeItem);

      prismaMock.orderItem.update.mockResolvedValue({
        id: itemId,
        status: 'cancelled',
        replacementStatus: 'ACCEPTED'
      });

      prismaMock.orderItem.create.mockResolvedValue({
        id: 999,
        itemId: alternativeItemId,
        itemName: 'Veggie Burger',
        quantity: 1,
        unitPrice: 6.0,
        lineTotal: 6.0,
        status: 'normal'
      });

      prismaMock.order.update.mockResolvedValue({
        id: orderId,
        total: '8.96',
        subtotal: '6.00',
        tax: '0.96',
        customerId: 100,
        orderNumber: 'ORD-001'
      });

      const result = await service.respondReplacement(orderId, itemId, true, 'DEDUCT_FROM_BILL', actor);

      expect(result.success).toBe(true);
      expect(result.order.subtotal).toBe('6.00'); // 6.00 alternative item
      expect(result.order.tax).toBe('0.96'); // 6.00 * 0.16 = 0.96
      expect(result.order.total).toBe('8.96'); // 6.00 + 0.96 + 2.00 delivery

      expect(prismaMock.orderItem.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: {
          status: 'cancelled',
          replacementStatus: 'ACCEPTED'
        }
      });

      expect(prismaMock.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          itemId: alternativeItemId,
          itemName: 'Veggie Burger',
          quantity: 1,
          unitPrice: 6.0,
          status: 'normal'
        })
      });

      // Verify notification sent
      expect(notificationServiceMock.sendToUser).toHaveBeenCalledWith(100, expect.objectContaining({
        title: 'تم استبدال الصنف بنجاح ✅',
        type: 'replacement_accepted'
      }));
    });

    test('successfully rejects replacement and creates coupon request if chosen', async () => {
      const orderId = 123;
      const itemId = 456;
      const actor = { id: 100, role: 'customer', uuid: 'cust-uuid' };

      const mockOrder = {
        id: orderId,
        orderNumber: 'ORD-001',
        branchId: 'branch-1',
        customerId: 100,
        deliveryFee: '2.00',
        discount: '0.00',
        total: '13.60',
        subtotal: '10.00',
        tax: '1.60',
        version: 1,
        orderItems: [
          {
            id: itemId,
            itemId: 111,
            itemName: 'Burger Extra',
            unitPrice: 5.0,
            quantity: 1,
            status: 'pending_replacement_approval'
          },
          {
            id: 457,
            itemId: 222,
            itemName: 'Fries',
            unitPrice: 5.0,
            quantity: 1,
            status: 'normal'
          }
        ]
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder);
      prismaMock.couponRequest.findFirst.mockResolvedValue(null);

      prismaMock.orderItem.update.mockResolvedValue({
        id: itemId,
        status: 'cancelled',
        replacementStatus: 'REJECTED'
      });

      prismaMock.order.update.mockResolvedValue({
        id: orderId,
        total: '7.80',
        subtotal: '5.00',
        tax: '0.80',
        customerId: 100,
        orderNumber: 'ORD-001'
      });

      const result = await service.respondReplacement(orderId, itemId, false, 'COUPON_REQUEST', actor);

      expect(result.success).toBe(true);
      expect(prismaMock.couponRequest.create).toHaveBeenCalledWith({
        data: {
          orderId,
          customerId: 100,
          itemId: 111,
          itemPrice: 5.0,
          status: 'PENDING'
        }
      });

      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version: 1 },
        data: expect.objectContaining({
          subtotal: '5.00', // Only fries remains (5.00)
          tax: '0.69',
          total: '7.00'
        }),
        include: expect.any(Object)
      });
    });

    test('throws error if rejection cancels last item', async () => {
      const orderId = 123;
      const itemId = 456;
      const actor = { id: 100, role: 'customer', uuid: 'cust-uuid' };

      const mockOrder = {
        id: orderId,
        orderItems: [
          { id: itemId, status: 'pending_replacement_approval' }
        ]
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.respondReplacement(orderId, itemId, false, 'DEDUCT_FROM_BILL', actor)
      ).rejects.toThrow('CANNOT_CANCEL_ALL_ITEMS');
    });
  });

  describe('requestCouponForCancelledItem', () => {
    test('successfully creates a coupon request for a cancelled item', async () => {
      const orderId = 123;
      const itemId = 456;
      const actor = { id: 100, role: 'customer', uuid: 'cust-uuid' };

      const mockOrder = {
        id: orderId,
        customerId: 100,
        orderItems: [
          { id: itemId, itemId: 111, unitPrice: 5.0, status: 'cancelled' }
        ]
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder);
      prismaMock.couponRequest.findFirst.mockResolvedValue(null);
      prismaMock.couponRequest.create.mockResolvedValue({ id: 'coupon-req-uuid' });

      const result = await service.requestCouponForCancelledItem(orderId, itemId, actor);

      expect(result.success).toBe(true);
      expect(prismaMock.couponRequest.create).toHaveBeenCalledWith({
        data: {
          orderId,
          customerId: 100,
          itemId: 111,
          itemPrice: 5.0,
          status: 'PENDING'
        }
      });
      expect(prismaMock.orderItem.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { resolutionPreference: 'COUPON_REQUEST' }
      });
    });

    test('throws error if unauthorized access', async () => {
      const mockOrder = {
        id: 123,
        customerId: 101, // Different customer
        orderItems: [
          { id: 456, status: 'cancelled' }
        ]
      };
      prismaMock.order.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.requestCouponForCancelledItem(123, 456, { id: 100, role: 'customer' })
      ).rejects.toThrow('UNAUTHORIZED_ORDER_ACCESS');
    });

    test('throws error if item is not cancelled', async () => {
      const mockOrder = {
        id: 123,
        customerId: 100,
        orderItems: [
          { id: 456, status: 'normal' }
        ]
      };
      prismaMock.order.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.requestCouponForCancelledItem(123, 456, { id: 100, role: 'customer' })
      ).rejects.toThrow('ITEM_NOT_CANCELLED');
    });
  });
});
