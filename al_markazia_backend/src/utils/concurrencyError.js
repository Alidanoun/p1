/**
 * @file concurrencyError.js
 * @description Named error class for optimistic locking violations (Lost Update detection).
 * Use for instanceof checks in global error handlers to return 409 Conflict.
 *
 * Usage:
 *   throw new ConcurrencyError('ORDER_CONFLICT', 'تعذر التحديث: حالة الطلب تغيرت.');
 *
 *   catch (err) {
 *     if (err instanceof ConcurrencyError) return res.status(409).json({ error: err.code, message: err.message });
 *   }
 */
class ConcurrencyError extends Error {
  constructor(code, message) {
    super(message || 'Concurrent update detected. Please retry.');
    this.name = 'ConcurrencyError';
    this.code = code || 'CONCURRENCY_CONFLICT';
    this.statusCode = 409;
  }
}

module.exports = { ConcurrencyError };
