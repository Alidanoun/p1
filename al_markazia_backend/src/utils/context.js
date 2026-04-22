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

module.exports = {
  traceContext,
  getRequestId
};
