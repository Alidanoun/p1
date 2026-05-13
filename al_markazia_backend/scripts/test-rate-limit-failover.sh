#!/bin/bash
# اختبار سلوك Fail-Open عند انقطاع خوادم Redis الخلفية في البيئة الموزعة

echo "🧪 Starting Rate Limiter Failover & Chaos Resilience Test..."

# 1. محاكاة تعطل Redis أو تأخر استجابته
if command -v redis-cli &> /dev/null; then
  echo "⏸️  Pausing Redis Engine state via DEBUG SLEEP..."
  redis-cli DEBUG SLEEP 5 &
fi

# 2. إرسال 200 طلب متزامن لمسار محمي
echo "🚀 Firing 200 concurrent load packets simulating active users..."
for i in {1..200}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer TEST_TOKEN" \
    -H "X-Request-ID: load-$i" \
    http://localhost:3000/api/orders &
done

wait

# 3. التحقق: يجب أن تمر معظم الطلبات (Fail-Open)
echo "✅ Test packet sequence concluded."
echo "📋 System should exhibit Fail-Open continuation. Check server logs for '[RateLimiter] Redis cluster anomaly, failing open gracefully'"

# 4. استعادة اتصال Redis
if command -v redis-cli &> /dev/null; then
  redis-cli DEBUG SLEEP 0 || true
fi
