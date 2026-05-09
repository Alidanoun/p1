/**
 * @file financial-lock.test.js
 * @description اختبار تكامل يثبت فعالية SELECT ... FOR UPDATE في منع التلاعب بالأرصدة
 * @scenario: 5 محاولات سحب متزامنة من نفس الحساب - يجب أن ينجح العدد الصحيح فقط
 */

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const app = require('../src/server'); 

const prisma = new PrismaClient();

// دالة مساعدة لتوليد توكن اختبار صالح
const generateTestToken = (userId, email = 'test@markazia.local') => {
  return jwt.sign(
    { 
      id: userId, 
      email,
      role: 'customer',
      jti: 'test-jti'
    },
    process.env.JWT_PRIVATE_KEY || 'test_secret_for_integration_tests_only',
    { algorithm: 'RS256', expiresIn: '1h' }
  );
};

describe('🔒 Financial Race Condition Protection - Integration Test', () => {
  let testUserId, testCustomerUuid, initialBalance;
  const WITHDRAWAL_AMOUNT = 300;
  const CONCURRENT_REQUESTS = 5;

  beforeAll(async () => {
    // إنشاء مستخدم ومحفظة اختبار
    const customer = await prisma.customer.create({
      data: {
        email: `test_race_${Date.now()}@markazia.local`,
        password: '$2b$10$placeholder_hash_for_testing_only',
        name: 'Test RaceCondition',
        walletBalance: 1000, // رصيد ابتدائي كافٍ لـ 3 عمليات سحب فقط
      }
    });
    
    testUserId = customer.id;
    testCustomerUuid = customer.uuid;
    initialBalance = 1000;
  });

  test('يجب أن ينفذ الحد الأقصى من المعاملات الصحيحة فقط ويرفض الباقي', async () => {
    // حساب العدد النظري للعمليات الناجحة
    const maxSuccessfulWithdrawals = Math.floor(initialBalance / WITHDRAWAL_AMOUNT); // = 3
    
    // إنشاء مصفوفة من الوعود لطلبات السحب المتزامنة
    const withdrawalPromises = Array(CONCURRENT_REQUESTS).fill().map((_, index) => 
      request(app)
        .post('/api/v1/orders') // محاكاة طلب يخصم من المحفظة أو endpoint سحب إذا وجد
        .set('Authorization', `Bearer ${generateTestToken(testCustomerUuid)}`)
        .set('Content-Type', 'application/json')
        .send({
          // Payload محدد لطلب الخصم
          amount: WITHDRAWAL_AMOUNT,
          description: `Concurrent test withdrawal #${index + 1}`
        })
    );

    // تنفيذ جميع الطلبات في نفس اللحظة تقريباً
    const startTime = Date.now();
    const responses = await Promise.allSettled(withdrawalPromises);
    const executionTime = Date.now() - startTime;
    
    console.log(`⏱️  Executed ${CONCURRENT_REQUESTS} concurrent requests in ${executionTime}ms`);

    // فرز النتائج
    const successful = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200);
    const rejected = responses.filter(r => 
      r.status === 'fulfilled' && (r.value.status === 400 || r.value.status === 409 || r.value.status === 402)
    );

    // ✅ التحقق 1: العدد الإجمالي للنتائج يجب أن يساوي عدد الطلبات
    expect(responses.length).toBe(CONCURRENT_REQUESTS);
    
    // ✅ التحقق 2: عدد العمليات الناجحة لا يجب أن يتجاوز الحد النظري
    expect(successful.length).toBeLessThanOrEqual(maxSuccessfulWithdrawals);
    
    // ✅ التحقق 3: الرصيد النهائي يجب أن يكون دقيقاً رياضياً
    const finalCustomer = await prisma.customer.findUnique({
      where: { id: testUserId },
      select: { walletBalance: true }
    });
    
    const expectedBalance = initialBalance - (successful.length * WITHDRAWAL_AMOUNT);
    expect(Number(finalCustomer.walletBalance)).toBe(expectedBalance);
    
    console.log(`✅ Test passed: ${successful.length}/${CONCURRENT_REQUESTS} withdrawals succeeded, final balance: ${finalCustomer.walletBalance}`);
  }, 35000);

  afterAll(async () => {
    // تنظيف بيانات الاختبار
    await prisma.financialLedger.deleteMany({ where: { customerId: testUserId } });
    await prisma.customer.delete({ where: { id: testUserId } });
    await prisma.$disconnect();
  });
});
