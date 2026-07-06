const { AsyncLocalStorage } = require('async_hooks');

/**
 * Shared Request Context for Tracing & Logging
 * Prevents circular dependencies between Logger and Middleware.
 */
if (!global.__traceContext) {
  global.__traceContext = new AsyncLocalStorage();
}
const traceContext = global.__traceContext;

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
  return new Promise((resolve, reject) => {
    traceContext.run({ isAdmin: true, bypassRls: true }, () => {
      try {
        const res = fn();
        if (res && typeof res.then === 'function') {
          res.then(resolve, reject);
        } else {
          resolve(res);
        }
      } catch (err) {
        reject(err);
      }
    });
  });
};

const runAsBranch = (branchId, fn) => {
  return new Promise((resolve, reject) => {
    traceContext.run({ branchId }, () => {
      try {
        const res = fn();
        if (res && typeof res.then === 'function') {
          res.then(resolve, reject);
        } else {
          resolve(res);
        }
      } catch (err) {
        reject(err);
      }
    });
  });
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
