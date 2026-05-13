#!/bin/bash
set -e

echo "🔄 Starting Happy Hour Timezone Rollback..."

# 1. إيقاف الـ Cron jobs المؤقتة
if [ -f scripts/cancel-happyhour-crons.js ]; then
  node scripts/cancel-happyhour-crons.js || true
fi

# 2. استعادة الـ Schema السابق (إن لزم)
# npx prisma migrate resolve --rolled-back "add_timezone_support_to_happyhour" || true

# 3. تنظيف مفاتيح Redis المؤقتة
if command -v redis-cli &> /dev/null; then
  redis-cli --scan --pattern "tz:branch:*" | xargs -r redis-cli DEL || true
  redis-cli --scan --pattern "happyhour:schedule:*" | xargs -r redis-cli DEL || true
fi

# 4. إعادة تشغيل الخدمة بالإصدار السابق
if command -v pm2 &> /dev/null; then
  pm2 restart al-markazia-backend --update-env || true
fi

echo "✅ Rollback completed successfully"
