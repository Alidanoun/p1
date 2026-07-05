const { AsyncLocalStorage } = require('async_hooks');

/**
 * Shared Request Context for Tracing & Logging
 * Prevents circular dependencies between Logger and Middleware.
 */
const traceContext = new AsyncLocalStorage();

const getRequestId = () => {
  const context = traceContext.getStore();
  return context ? context.requestId : null;
};

const getCorrelationId = () => {
  const context = traceContext.getStore();
  return context ? context.correlationId : null;
};

const getBranchId = () => {
  const context = traceContext.getStore();
  return context ? context.branchId : null;
};

const getRegion = () => {
  const context = traceContext.getStore();
  return context ? context.region : 'GLOBAL';
};

const runAsSystemAdmin = (fn) => {
  return traceContext.run({ isAdmin: true, bypassRls: true }, fn);
};

const runAsBranch = (branchId, fn) => {
  return traceContext.run({ branchId }, fn);
};

module.exports = {
  traceContext,
  getRequestId,
  getCorrelationId,
  getBranchId,
  getRegion,
  runAsSystemAdmin,
  runAsBranch
};
