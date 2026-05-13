const { OrderModificationOrchestrator } = require('../../src/services/orderModificationOrchestrator');

describe('OrderModificationOrchestrator - Security Tests (IDOR Guard)', () => {
  let orchestrator;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      security: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
    orchestrator = new OrderModificationOrchestrator({
      logger: mockLogger,
      prisma: {}
    });
  });

  describe('_verifyOrderOwnership', () => {
    test('يجب رفض عميل يحاول الوصول لطلب عميل آخر وإطلاق حدث أمني', () => {
      const order = { id: 100, customerId: 50, branchId: 'branch_1' };
      const attacker = { id: 99, role: 'customer' };

      expect(() => {
        orchestrator._verifyOrderOwnership(order, attacker);
      }).toThrow('UNAUTHORIZED_ORDER_ACCESS');

      expect(mockLogger.security).toHaveBeenCalledWith(
        'UNAUTHORIZED_ORDER_ACCESS_ATTEMPT',
        expect.objectContaining({
          userId: 99,
          targetOrderId: 100,
          targetCustomerId: 50
        })
      );
    });

    test('يجب قبول العميل المالك للطلب الخاص به', () => {
      const order = { id: 100, customerId: 50, branchId: 'branch_1' };
      const owner = { id: 50, role: 'customer' };

      expect(() => {
        orchestrator._verifyOrderOwnership(order, owner);
      }).not.toThrow();
    });

    test('يجب رفض مدير فرع يحاول الوصول لطلب تابع لفرع آخر', () => {
      const order = { id: 100, customerId: 50, branchId: 'branch_1' };
      const maliciousManager = { id: 10, role: 'branch_manager', branchId: 'branch_2' };

      expect(() => {
        orchestrator._verifyOrderOwnership(order, maliciousManager);
      }).toThrow('UNAUTHORIZED_BRANCH_ACCESS');

      expect(mockLogger.security).toHaveBeenCalledWith(
        'UNAUTHORIZED_BRANCH_ACCESS_ATTEMPT',
        expect.objectContaining({
          userId: 10,
          targetOrderId: 100,
          targetBranchId: 'branch_1',
          actualBranchId: 'branch_2'
        })
      );
    });

    test('يجب السماح لمدير النظام الشامل (Global Admin) بالوصول لأي فرع', () => {
      const order = { id: 100, customerId: 50, branchId: 'branch_1' };
      const globalAdmin = { id: 1, role: 'admin' };

      expect(() => {
        orchestrator._verifyOrderOwnership(order, globalAdmin);
      }).not.toThrow();
    });
  });

  describe('_validateModificationItems', () => {
    test('يجب رفض مصفوفة إزالة تحتوي على معرف عنصر لا ينتمي للطلب مع تسجيل تحذير', () => {
      const order = {
        id: 100,
        orderItems: [{ id: 1 }, { id: 2 }]
      };
      const modifications = { removeIds: [999] };

      expect(() => {
        orchestrator._validateModificationItems(order, modifications);
      }).toThrow('INVALID_ITEM_ID');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'INVALID_MODIFICATION_ITEM_ATTEMPT',
        expect.objectContaining({
          orderId: 100,
          invalidItemId: 999
        })
      );
    });

    test('يجب قبول مصفوفة إزالة تحتوي على معرفات تنتمي للطلب الفعلي', () => {
      const order = {
        id: 100,
        orderItems: [{ id: 1 }, { id: 2 }]
      };
      const modifications = { removeIds: [1], type: 'PARTIAL_CANCEL' };

      expect(() => {
        orchestrator._validateModificationItems(order, modifications);
      }).not.toThrow();
    });

    test('يجب منع إزالة كافة عناصر الطلب دون تمرير نوع FULL_CANCEL', () => {
      const order = {
        id: 100,
        orderItems: [{ id: 1 }, { id: 2 }]
      };
      const modifications = { removeIds: [1, 2], type: 'PARTIAL_CANCEL' };

      expect(() => {
        orchestrator._validateModificationItems(order, modifications);
      }).toThrow('CANNOT_REMOVE_ALL_ITEMS_WITHOUT_FULL_CANCEL');
    });

    test('يجب السماح بإزالة كافة العناصر إذا كان النوع FULL_CANCEL', () => {
      const order = {
        id: 100,
        orderItems: [{ id: 1 }, { id: 2 }]
      };
      const modifications = { removeIds: [1, 2], type: 'FULL_CANCEL' };

      expect(() => {
        orchestrator._validateModificationItems(order, modifications);
      }).not.toThrow();
    });
  });

  describe('_simulateChanges', () => {
    test('يجب إرجاع مصفوفة فارغة في حالة FULL_CANCEL', async () => {
      const items = [{ id: 1 }, { id: 2 }];
      const res = await orchestrator._simulateChanges(items, { type: 'FULL_CANCEL' });
      expect(res).toEqual([]);
    });

    test('يجب إزالة العناصر المحددة بشكل آمن ومطابقة المعرفات كنصوص', async () => {
      const items = [{ id: 1 }, { id: '2' }, { id: 3 }];
      const res = await orchestrator._simulateChanges(items, { removeIds: [2, '3'] });
      expect(res).toEqual([{ id: 1 }]);
    });
  });
});
