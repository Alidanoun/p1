const Decimal = require('decimal.js');

// إعدادات عالمية للدقة المالية
Decimal.set({
  precision: 20,      // دقة عالية للحسابات الوسيطة
  rounding: Decimal.ROUND_HALF_UP,  // التقريب المصرفي القياسي
  toExpNeg: -7,       // منع الترميز العلمي للأرقام الصغيرة
  toExpPos: 21
});

const Money = {
  // إنشاء كائن نقدي
  from: (value) => {
    if (value instanceof Decimal) return value;
    if (value === null || value === undefined) return new Decimal(0);
    if (typeof value === 'number') {
      // تحويل الرقم العائم إلى سلسلة لتجنب التشوه
      return new Decimal(value.toFixed(10));
    }
    // Handle Prisma Decimal objects that have d/e/s fields or custom toString()
    if (value && typeof value === 'object' && typeof value.toString === 'function') {
      return new Decimal(value.toString());
    }
    return new Decimal(value);
  },
  
  // جمع آمن
  add: (...values) => {
    return values.reduce((sum, val) => sum.plus(Money.from(val)), new Decimal(0));
  },
  
  // طرح آمن
  subtract: (a, b) => Money.from(a).minus(Money.from(b)),
  
  // ضرب آمن (للخصومات والضرائب)
  multiply: (value, factor) => Money.from(value).times(Money.from(factor)),
  
  // قسمة آمنة (لتوزيع المبالغ)
  divide: (value, divisor) => Money.from(value).div(Money.from(divisor)),
  
  // تقريب للعرض/التخزين (منزلتين عشريتين)
  toFixed: (value, decimals = 2) => {
    return Money.from(value).toDecimalPlaces(decimals).toNumber();
  },
  
  // مقارنة مع هامش خطأ
  equals: (a, b, epsilon = 0.001) => {
    return Money.from(a).minus(Money.from(b)).abs().lessThan(epsilon);
  },
  
  // تحقق من أن القيمة مالية صالحة
  isValid: (value) => {
    try {
      const d = Money.from(value);
      return d.isFinite() && !d.isNaN() && d.gte(0);
    } catch {
      return false;
    }
  }
};

module.exports = { Money, Decimal };
