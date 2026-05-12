/**
 * ⚡ Parallel Batch Concurrency Helper
 * Purpose: Launches high-volume concurrent operations simultaneously using Promise.all 
 * to reliably simulate Race Conditions and prove Idempotency/Optimistic Locking under load.
 */

/**
 * Executes a function multiple times concurrently in a synchronized batch.
 * @param {number} count - Number of concurrent operations to launch
 * @param {Function} fn - Function returning a Promise representing the operation
 * @returns {Promise<Object>}
 */
const runConcurrentBatch = async (count, fn) => {
  // Launch operations simultaneously to flood the target service
  const promises = Array(count).fill(null).map((_, index) => fn(index));
  const startTime = Date.now();
  const results = await Promise.allSettled(promises);
  const durationMs = Date.now() - startTime;
  
  return {
    results,
    durationMs,
    fulfilledCount: results.filter(r => r.status === 'fulfilled').length,
    rejectedCount: results.filter(r => r.status === 'rejected').length
  };
};

/**
 * Premium Assertions Analyzer for Concurrency Tests
 */
const analyzeIdempotencyResults = (batchResults) => {
  const { results } = batchResults;
  
  // For idempotency or unique constraints, exactly 1 should succeed/process normally,
  // or subsequent calls should return cached identical responses or concurrency/busy errors.
  const successfulCalls = results.filter(r => r.status === 'fulfilled' && !r.value?.error);
  const conflictOrCachedCalls = results.filter(r => 
    r.status === 'rejected' || 
    r.value?.error || 
    r.value?.status === 'COMPLETED' ||
    r.value?.cached ||
    r.reason?.message?.includes('SYSTEM_BUSY') ||
    r.reason?.message?.includes('CONCURRENCY_CONFLICT')
  );

  return {
    successfulCalls,
    conflictOrCachedCalls,
    totalCount: results.length
  };
};

module.exports = {
  runConcurrentBatch,
  analyzeIdempotencyResults
};
