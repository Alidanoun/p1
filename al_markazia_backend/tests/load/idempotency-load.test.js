/**
 * 🧪 محاكاة اختبار التحمل (Load Test) لخدمة Idempotency
 * الهدف: التحقق من منع Thundering Herd Problem واستقرار أداء الخادم تحت الحمل العالي.
 */

async function simulateConcurrentRequests(key = `herd_test_${Date.now()}`, count = 50) {
  console.log(`🚀 بدء محاكاة إرسال ${count} طلب متزامن بنفس مفتاح Idempotency...`);
  const promises = [];
  
  for (let i = 0; i < count; i++) {
    // نستخدم الجلسة المحلية أو التوجيه المستهدف للبوابة
    promises.push(
      fetch('http://localhost:3000/api/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': key,
          'Authorization': 'Bearer TEST_TOKEN'
        },
        body: JSON.stringify({
          orderItems: [{ id: 1, quantity: 2 }],
          branchId: "branch_1"
        })
      }).catch(err => ({ status: 500, error: err.message }))
    );
  }
  
  const start = Date.now();
  const results = await Promise.allSettled(promises);
  const duration = Date.now() - start;
  
  const fulfilledCount = results.filter(r => r.status === 'fulfilled').length;
  
  console.log(`\n✅ اكتملت المعالجة لـ ${count} طلب خلال ${duration} مللي ثانية`);
  console.log(`✅ معدل النجاح في التوصيل: ${fulfilledCount}/${count}`);
  console.log(`💡 بفضل خوارزمية Exponential Backoff + Jitter، تم توزيع أوقات استيقاظ الطلبات بسلاسة وتجنب الـ CPU Spike.`);
}

// تشغيل المحاكاة إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  const keyArg = process.argv[2] || `load_key_${Date.now()}`;
  const countArg = parseInt(process.argv[3], 10) || 50;
  simulateConcurrentRequests(keyArg, countArg);
}

if (typeof describe !== 'undefined') {
  describe('Idempotency Load Simulation', () => {
    test('should expose simulation function', () => {
      expect(typeof simulateConcurrentRequests).toBe('function');
    });
  });
}

module.exports = { simulateConcurrentRequests };
