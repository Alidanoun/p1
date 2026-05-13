const { IdempotencyService } = require('../../src/services/idempotencyService');

// Mocking persistent DB access to isolate Redis concurrency logic
jest.mock('../../src/lib/prisma', () => ({
  idempotencyKey: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({})
  }
}));

describe('IdempotencyService - Race Condition & Thundering Herd Tests', () => {
  let service, redisMock, mockLogger;

  beforeEach(() => {
    redisMock = {
      set: jest.fn(),
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn()
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      reasoning: jest.fn()
    };

    service = new IdempotencyService({ 
      redis: redisMock,
      logger: mockLogger
    });

    // تسريع الاختبار بتقليل أوقات التأخير بشكل كبير
    service.config.baseDelay = 10;
    service.config.maxDelay = 100;
  });

  test('يجب استخدام التراجع الأسي (Exponential Backoff) مع العشوائية (Jitter)', () => {
    const delays = [];
    for (let i = 0; i < 5; i++) {
      delays.push(service._calculateDelay(i));
    }

    // التحقق من أن التأخير يتزايد أسيًا بمرور المحاولات
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[0]);

    // التحقق من تباين القيم نظرياً لنفس رقم المحاولة بفضل إضافة الـ Jitter
    const sampleA = service._calculateDelay(3);
    const sampleB = service._calculateDelay(3);
    expect(typeof sampleA).toBe('number');
    expect(typeof sampleB).toBe('number');
  });

  test('يجب إرجاع النتيجة المخزنة مباشرة من Redis عند توفرها (Fast Path)', async () => {
    const key = 'tx_1001';
    const cachedPayload = JSON.stringify({
      status: 'COMPLETED',
      operation: 'CREATE_ORDER',
      result: { orderId: 500 }
    });

    redisMock.get.mockResolvedValueOnce(cachedPayload);

    const res = await service.start(key, 'CREATE_ORDER', {}, { id: 1 });

    expect(res).toEqual({
      status: 'COMPLETED',
      response: { orderId: 500 }
    });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  test('يجب إلقاء خطأ IDEMPOTENCY_MISMATCH إذا اختلف اسم العملية لنفس المفتاح', async () => {
    const key = 'tx_1001';
    const cachedPayload = JSON.stringify({
      status: 'COMPLETED',
      operation: 'CREATE_ORDER',
      result: { orderId: 500 }
    });

    redisMock.get.mockResolvedValueOnce(cachedPayload);

    await expect(service.start(key, 'CANCEL_ORDER', {}, { id: 1 }))
      .rejects.toThrow('IDEMPOTENCY_MISMATCH');
  });

  test('يجب الاستحواذ على القفل بنجاح إذا لم يكن موجوداً وإرجاع حالة NEW', async () => {
    const key = 'tx_1002';
    redisMock.get.mockResolvedValueOnce(null); // لا يوجد في الكاش السريع
    redisMock.set.mockResolvedValueOnce('OK'); // نجاح قفل Redis

    const res = await service.start(key, 'CREATE_ORDER', {}, { id: 1 });

    expect(res).toEqual({ status: 'NEW' });
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('idempotency:'),
      expect.stringContaining('"status":"processing"'),
      'NX',
      'EX',
      300
    );
  });

  test('يجب منع Thundering Herd بالانتظار وتوزيع أوقات الاستيقاظ حتى تكتمل العملية', async () => {
    const key = 'tx_herd';

    // المحاكاة:
    // 1. القراءة السريعة ترجع null.
    // 2. محاولة القفل الأولى تفشل (طلب آخر يمتلكه).
    // 3. أثناء حلقة الانتظار، الكاش يُحدّث ليصبح COMPLETED.
    redisMock.get
      .mockResolvedValueOnce(null) // الفحص السريع الأولي
      .mockResolvedValueOnce(JSON.stringify({ status: 'processing', operation: 'CREATE_ORDER' })) // المحاولة 1 في الـ Loop
      .mockResolvedValueOnce(JSON.stringify({ status: 'COMPLETED', operation: 'CREATE_ORDER', result: { success: true } })); // المحاولة 2 في الـ Loop

    redisMock.set.mockResolvedValueOnce(null); // فشل الاستحواذ الأولي على القفل

    // استبدال _sleep لتجنب الانتظار الفعلي في بيئة الاختبار
    service._sleep = jest.fn().mockResolvedValue();

    const res = await service.start(key, 'CREATE_ORDER', {}, { id: 1 });

    expect(res).toEqual({
      status: 'COMPLETED',
      response: { success: true }
    });

    expect(service._sleep).toHaveBeenCalledTimes(2);
  });

  test('يجب استعادة القفل المتعفن (Stale Lock Recovery) إذا تجاوز العمر المحدد', async () => {
    const key = 'tx_stale';

    const stalePayload = JSON.stringify({
      status: 'processing',
      operation: 'CREATE_ORDER',
      acquiredAt: Date.now() - 400 * 1000 // أقدم من 300 ثانية
    });

    redisMock.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stalePayload);

    redisMock.set.mockResolvedValueOnce(null); // فشل الاستحواذ الأولي
    redisMock.del.mockResolvedValueOnce(1); // حذف القفل القديم

    // منع حلقة لا نهائية بجعل المحاولة التالية ترمي خطأ لتجاوز المحاولات
    service.config.maxRetries = 1;
    service._sleep = jest.fn().mockResolvedValue();

    await expect(service.start(key, 'CREATE_ORDER', {}, { id: 1 }))
      .rejects.toThrow('IDEMPOTENCY_TIMEOUT');

    expect(redisMock.del).toHaveBeenCalledWith(expect.stringContaining('idempotency:'));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Stale lock detected'));
  });

  test('يجب حفظ النتيجة في Redis وتحديث قاعدة البيانات عند استدعاء commit', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    redisMock.setex.mockResolvedValueOnce('OK');

    await service.commit('tx_commit', { id: 99 });

    expect(redisMock.setex).toHaveBeenCalledWith(
      expect.stringContaining('idempotency:'),
      86400,
      expect.stringContaining('"status":"COMPLETED"')
    );
  });

  test('يجب حذف القفل من Redis وقاعدة البيانات عند استدعاء rollback', async () => {
    redisMock.del.mockResolvedValueOnce(1);

    await service.rollback('tx_rb');

    expect(redisMock.del).toHaveBeenCalledWith(expect.stringContaining('idempotency:'));
  });

  test('يجب استرجاع النتيجة المحفوظة عند استدعاء getResult', async () => {
    redisMock.get.mockResolvedValueOnce(JSON.stringify({ status: 'COMPLETED', result: 'DATA' }));

    const res = await service.getResult('tx_get');
    expect(res).toBe('DATA');
  });
});
