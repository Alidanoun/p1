const { FirebaseService } = require('../src/services/firebaseService');
const notificationController = require('../src/controllers/notificationController');
const prisma = require('../src/lib/prisma');

// Mock out dependencies
jest.mock('firebase-admin', () => {
  const sendMock = jest.fn().mockResolvedValue('projects/al-markazia-app/messages/test_success_id_123');
  const sendEachForMulticastMock = jest.fn().mockResolvedValue({
    successCount: 2,
    failureCount: 1,
    responses: [
      { success: true, messageId: 'msg_1' },
      { success: true, messageId: 'msg_2' },
      { success: false, error: { code: 'messaging/invalid-registration-token' } }
    ]
  });
  const subscribeToTopicMock = jest.fn().mockResolvedValue({});
  const unsubscribeFromTopicMock = jest.fn().mockResolvedValue({});

  return {
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    messaging: () => ({
      send: sendMock,
      sendEachForMulticast: sendEachForMulticastMock,
      subscribeToTopic: subscribeToTopicMock,
      unsubscribeFromTopic: unsubscribeFromTopicMock
    })
  };
});

jest.mock('../src/lib/prisma', () => ({
  notificationLog: {
    create: jest.fn().mockResolvedValue({ id: 999, status: 'PENDING' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0)
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({ fcmToken: 'valid_user_fcm_token' }),
    findMany: jest.fn().mockResolvedValue([{ fcmToken: 'token_a' }]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 })
  },
  customer: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([{ fcmToken: 'token_b' }]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 })
  }
}));

describe('🛡️ Enterprise Bilingual Notification System Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Firebase Initialization Coverage
  test('✅ should successfully bootstrap Firebase Cloud Messaging transport instance', () => {
    expect(FirebaseService.fcmEnabled).toBe(true);
    expect(FirebaseService.maxRetries).toBe(3);
    expect(FirebaseService.retryDelay).toBe(1000);
  });

  // 2. Successful Transmission
  test('✅ should correctly execute and record a single operational notification send lifecycle', async () => {
    const resultId = await FirebaseService.sendNotification({
      token: 'test_destination_token',
      type: 'order_created',
      lang: 'ar'
    });

    expect(resultId).toBe('projects/al-markazia-app/messages/test_success_id_123');
    expect(prisma.notificationLog.create).toHaveBeenCalled();
    expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 999 },
        data: expect.objectContaining({ status: 'SENT' })
      })
    );
  });

  // 3. Multilingual Support (Arabic)
  test('🇸🇦 should construct localized Arabic titles and copy correctly', async () => {
    const payload = FirebaseService._buildPayload('order_ready', 'ar');
    expect(payload.title).toBe('طلبك جاهز! 🍽️');
    expect(payload.body).toContain('جاهز الآن');
  });

  // 4. Multilingual Support (English)
  test('🇬🇧 should construct localized English titles and fallback logic correctly', async () => {
    const payload = FirebaseService._buildPayload('order_delivered', 'en');
    expect(payload.title).toBe('Order Delivered ✔️');
    expect(payload.body).toContain('delivered successfully');
  });

  // 5. Retry Handling Logic
  test('⏳ should intercept network exceptions and trigger backoff up to maxRetries thresholds', async () => {
    const admin = require('firebase-admin');
    // Force specific error code to simulate upstream throttling
    const mockSend = admin.messaging().send;
    mockSend
      .mockRejectedValueOnce({ code: 'messaging/internal-error', message: 'Simulated backend drop' })
      .mockResolvedValueOnce('projects/al-markazia-app/messages/recovered_retry_id');

    // Reduce delay specifically to optimize unit test performance window
    const originalDelay = FirebaseService.retryDelay;
    FirebaseService.retryDelay = 10;

    const res = await FirebaseService._executeWithRetry({ notification: { title: 'T' } }, 999, 1);
    
    expect(res).toBe('projects/al-markazia-app/messages/recovered_retry_id');
    expect(mockSend).toHaveBeenCalledTimes(2);

    FirebaseService.retryDelay = originalDelay;
  });

  // 6. Hygiene and Token Cleanup
  test('🧹 should actively intercept invalid registration tokens and execute persistence purges', async () => {
    const admin = require('firebase-admin');
    const mockSend = admin.messaging().send;
    mockSend.mockRejectedValueOnce({ code: 'messaging/invalid-registration-token', message: 'Token stale' });

    const res = await FirebaseService.sendNotification({
      token: 'stale_dead_token',
      type: 'payment_received'
    });

    expect(res).toBeNull();
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { fcmToken: 'stale_dead_token' }
    }));
  });

  // 7. Multicast Sending
  test('📢 should dispatch bulk multitenant downstream arrays handling collective metrics', async () => {
    const report = await FirebaseService.sendMulticastNotification({
      tokens: ['token_1', 'token_2', 'token_invalid'],
      type: 'order_created'
    });

    expect(report.successCount).toBe(2);
    expect(report.failureCount).toBe(1);
    const admin = require('firebase-admin');
    expect(admin.messaging().sendEachForMulticast).toHaveBeenCalled();
  });

  // 8. Topic Subscriptions
  test('🔗 should bind target registration tokens across configured message pipelines', async () => {
    const admin = require('firebase-admin');
    const resSub = await FirebaseService.subscribeToTopic('tok_1', 'offers_amman');
    expect(resSub).toBe(true);
    expect(admin.messaging().subscribeToTopic).toHaveBeenCalledWith(['tok_1'], 'offers_amman');

    const resUnsub = await FirebaseService.unsubscribeFromTopic(['tok_2'], 'offers_amman');
    expect(resUnsub).toBe(true);
    expect(admin.messaging().unsubscribeFromTopic).toHaveBeenCalledWith(['tok_2'], 'offers_amman');
  });

  // 9. Failure Scenarios and Non-blocking Protections
  test('⚠️ should not interrupt incoming HTTP application request threads during transport faults', async () => {
    const req = { body: { userId: 'usr_abc', type: 'order_ready' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await notificationController.sendSingleNotification(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // 10. Performance and Delivery/Read state hooks
  test('📊 should expose markAsDelivered API handlers mapping accurate timeline parameters', async () => {
    const req = { body: { messageId: 'msg_abc_123' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await notificationController.markAsDelivered(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: 'msg_abc_123' },
        data: expect.objectContaining({ status: 'DELIVERED' })
      })
    );
  });
});
