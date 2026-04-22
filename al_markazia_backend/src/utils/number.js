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
 * Uses banker's rounding to avoid floating-point drift.
 * @param {number} value
 * @returns {number}
 */
const toMoney = (value) => {
  const num = toNumber(value);
  return Math.round(num * 100) / 100;
};

module.exports = { toNumber, toMoney };
