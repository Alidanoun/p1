const Decimal = require('decimal.js');

// Configure Decimal default rounding mode to ROUND_HALF_UP globally for consistency.
// Using ROUND_HALF_UP for customer-facing invoices
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * 🔢 Safe Number Utility (Production-Grade)
 * Converts any Prisma Decimal, string, null, or undefined to a safe JS Number.
 * This is the ONLY way to handle monetary values in the system.
 */

/**
 * Safely converts any value to a JavaScript Number.
 * Handles: Prisma.Decimal, string, null, undefined, NaN, Infinity.
 * @param {any} value - The value to convert
 * @param {number} fallback - Default if conversion fails (default: 0)
 * @returns {number} A safe JS number, never NaN
 */
const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined) return fallback;

  // Prisma Decimal has a toNumber() method
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const result = value.toNumber();
    return isFinite(result) ? result : fallback;
  }

  const num = Number(value);
  return isFinite(num) ? num : fallback;
};

/**
 * Rounds a number to 2 decimal places (monetary precision).
 * Uses robust Decimal.js arbitrary precision logic.
 * Using ROUND_HALF_UP for customer-facing invoices
 * @param {any} value
 * @returns {number}
 */
const toMoney = (value) => {
  if (value === null || value === undefined) return 0;
  try {
    const valStr = typeof value === 'object' && typeof value.toString === 'function' ? value.toString() : String(value);
    const d = new Decimal(valStr);
    return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  } catch (err) {
    return toNumber(value, 0);
  }
};

/**
 * 🧱 Safely creates a Decimal instance from any value.
 * Preserves exact string/Prisma representation to prevent initial precision loss.
 */
const toDecimal = (value, fallback = 0) => {
  if (value === null || value === undefined) return new Decimal(fallback);
  try {
    if (value instanceof Decimal) return value;
    const valStr = typeof value === 'object' && typeof value.toString === 'function' ? value.toString() : String(value);
    return new Decimal(valStr);
  } catch (err) {
    return new Decimal(fallback);
  }
};

/**
 * 📝 Formats a value as a strict decimal string with 2 decimal places for direct Prisma injection.
 * Ensures strict lazy rounding behavior and seamless Prisma schema alignment.
 */
const toMoneyString = (value) => {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
};

/**
 * 🧮 Safely aggregates an array of values into a Decimal sum.
 * Prevents precision drift during high-volume summations.
 */
const sumDecimals = (items, accessor = (x) => x) => {
  return items.reduce((sum, item) => {
    return sum.plus(toDecimal(accessor(item)));
  }, new Decimal(0));
};

module.exports = { toNumber, toMoney, toDecimal, toMoneyString, sumDecimals, Decimal };
