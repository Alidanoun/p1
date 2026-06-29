const { NotificationService } = require('../src/services/notificationService');

// Mock container
const container = {
  prisma: {
    notificationLog: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    restaurantSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn()
    }
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
};

// Mock firebaseService
const mockSendToTopic = jest.fn();
const mockSendToToken = jest.fn();
const mockSendBroadcast = jest.fn();

jest.mock('../src/services/firebaseService', () => ({
  sendToTopic: (...args) => mockSendToTopic(...args),
  sendToToken: (...args) => mockSendToToken(...args),
  sendBroadcast: (...args) => mockSendBroadcast(...args)
}));

describe('Parallel Push Notification Delivery Tests', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(container);
  });

  test('✅ should send to both admin and customer in parallel when both are targeted', async () => {
    const notif = {
      id: 123,
      title: 'Test Notification',
      body: 'Body text',
      type: 'order_created',
      userId: 'admin' // First, test the admin target path
    };

    const notifCustomer = {
      id: 124,
      title: 'Test Notification',
      body: 'Body text',
      type: 'order_created',
      userId: 'customer-uuid-xyz' // Then, test the customer target path
    };

    const order = {
      id: 456,
      customer: {
        fcmToken: 'customer-token-123'
      }
    };

    const target = {
      isToAdmin: true,
      isToCustomer: true,
      isBroadcast: false
    };

    // 1. Send the admin portion
    mockSendToTopic.mockResolvedValue('msg-topic-123');
    await service._attemptFCMPush(notif, order, target);
    expect(mockSendToTopic).toHaveBeenCalledWith(
      'staff_orders',
      'Test Notification',
      'Body text',
      { type: 'order_created', logId: '123' }
    );
    expect(mockSendToToken).not.toHaveBeenCalled();

    // 2. Send the customer portion
    jest.clearAllMocks();
    mockSendToToken.mockResolvedValue('msg-token-123');
    await service._attemptFCMPush(notifCustomer, order, target);
    expect(mockSendToToken).toHaveBeenCalledWith(
      'customer-token-123',
      'Test Notification',
      'Body text',
      { type: 'order_created', logId: '124' }
    );
    expect(mockSendToTopic).not.toHaveBeenCalled();
  });

  test('⚠️ should throw error when one of the parallel sends fails', async () => {
    const notif = {
      id: 123,
      title: 'Test Notification',
      body: 'Body text',
      type: 'order_created',
      userId: 'admin'
    };

    const order = {
      id: 456,
      customer: {
        fcmToken: 'customer-token-123'
      }
    };

    const target = {
      isToAdmin: true,
      isToCustomer: true,
      isBroadcast: false
    };

    // Force failure
    mockSendToTopic.mockResolvedValue(null); // Failure in delivery returning null

    await expect(service._attemptFCMPush(notif, order, target)).rejects.toThrow('admin: Delivery returned null');
  });
});
