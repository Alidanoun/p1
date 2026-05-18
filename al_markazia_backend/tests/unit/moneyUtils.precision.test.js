const { Money, Decimal } = require('../../src/utils/money');

describe('Money utils floating-point safety', () => {
  test('0.1 + 0.2 = 0.3 exactly', () => {
    const result = Money.add(0.1, 0.2);
    expect(Money.toFixed(result)).toBe(0.3);
    expect(result.toString()).not.toContain('0.30000000000000004');
  });

  test('خصم 15% على 99.99 لا ينتج تشوهاً', () => {
    const price = 99.99;
    const discount = Money.multiply(price, 0.15);
    const final = Money.subtract(price, discount);
    
    // القيمة المتوقعة: 99.99 * 0.85 = 84.9915 → تقريب لـ 84.99
    expect(Money.toFixed(final)).toBe(84.99);
  });

  test('تراكم 10000 عملية لا يسبب انحرافاً', () => {
    let sum = new Decimal(0);
    for (let i = 0; i < 10000; i++) {
      sum = sum.plus(0.1);
    }
    // المتوقع: 1000.00 تماماً
    expect(Money.toFixed(sum)).toBe(1000);
    
    // مقارنة مع الطريقة القديمة (ستفشل)
    let oldSum = 0;
    for (let i = 0; i < 10000; i++) {
      oldSum += 0.1;
    }
    expect(oldSum).not.toBe(1000);  // سيكون 999.9999999999999
  });
});
