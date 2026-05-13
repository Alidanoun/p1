-- 1. تعيين المنطقة الزمنية ودولة الفروع بناءً على الكود أو التواجد الفعلي
UPDATE "Branch" 
SET timezone = CASE 
  WHEN code LIKE '%AE%' OR name LIKE '%Dubai%' OR name LIKE '%دبي%' THEN 'Asia/Dubai'
  WHEN code LIKE '%SA%' OR name LIKE '%Riyadh%' OR name LIKE '%الرياض%' THEN 'Asia/Riyadh'
  WHEN code LIKE '%EG%' OR name LIKE '%Cairo%' OR name LIKE '%القاهرة%' THEN 'Africa/Cairo'
  WHEN code LIKE '%JO%' OR name LIKE '%Amman%' OR name LIKE '%عمان%' THEN 'Asia/Amman'
  ELSE 'Africa/Cairo' -- Fallback
END
WHERE timezone IS NULL;

-- 2. نسخ منطقة الفرع لـ HappyHour المرتبط
UPDATE "HappyHour" hh
SET timezone = b.timezone
FROM "Branch" b
WHERE hh."branchId" = b.id AND hh.timezone IS NULL;

-- 3. تعيين منطقة العميل الافتراضية
UPDATE "Customer" 
SET timezone = 'Africa/Cairo' 
WHERE timezone IS NULL;

-- 4. التأكد من إنشاء الفهارس لتسريع الاستعلامات الزمنية
CREATE INDEX IF NOT EXISTS "HappyHour_timezone_idx" ON "HappyHour"("timezone");
CREATE INDEX IF NOT EXISTS "HappyHour_branchId_active_idx" ON "HappyHour"("branchId", "isActive");
