const { AsyncLocalStorage } = require('async_hooks');

/**
 * 🔒 Security Context Provider
 * Uses Node.js AsyncLocalStorage to maintain user session data across 
 * asynchronous calls without explicit prop drilling.
 * Essential for the global Prisma Isolation Layer.
 */
const securityContext = new AsyncLocalStorage();

module.exports = {
  securityContext,
  
  /**
   * Run a function within a secure context.
   */
  runInContext: (data, fn) => securityContext.run(data, fn),
  
  /**
   * Get the current user from the context.
   */
  getContext: () => securityContext.getStore()
};
