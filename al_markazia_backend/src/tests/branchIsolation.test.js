const { BRANCH_ISOLATED_MODELS } = require('../config/branchIsolation');
const prisma = require('../lib/prisma');

/**
 * 🧪 Branch Isolation Security Compliance Test
 * Proactively prevents "Silent Isolation Gaps" by verifying that all
 * new Prisma models containing sensitive keywords are explicitly isolated.
 */
describe('Branch Isolation Security Compliance', () => {
  test('Every model containing sensitive keywords must be registered in BRANCH_ISOLATED_MODELS', () => {
    // 1. Resolve all active database models from Prisma
    const prismaKeys = Object.keys(prisma);
    const prismaModels = prismaKeys.filter(key => {
      return !key.startsWith('_') && 
             typeof prisma[key] === 'object' && 
             prisma[key] !== null && 
             typeof prisma[key].findMany === 'function';
    });

    // 2. Define sensitive branch-scoped domain keywords
    const sensitiveKeywords = [
      'Branch', 
      'Order', 
      'Financial', 
      'AuditLog', 
      'Ledger', 
      'Approval', 
      'Metric'
    ];

    // Models that are explicitly exempt from branch isolation (e.g., global reference tables)
    const EXEMPT_MODELS = new Set([
      'branch', // Branch itself is isolated by its 'id' rather than having a 'branchId' field
      'orderitem', // Nested under Order, does not directly contain a 'branchId' column
      'userbranch', // Security mapping table queried globally to resolve authorized branches
      'healthmetric', // Global system health metrics (CPU, RAM, latency) without branch scoping
      'loyaltyledger', // Loyalty transactions are global customer aggregates, not scoped by branch
      'userbranchpreference', // User-specific UI and session workspace settings loaded globally
      'biometricdevice' // Biometric authentication device (false positive containing the letters 'metric')
    ]);

    // 3. Audit each model
    prismaModels.forEach(model => {
      const lowerModel = model.toLowerCase();
      if (EXEMPT_MODELS.has(lowerModel)) return;

      const isSensitive = sensitiveKeywords.some(keyword => lowerModel.includes(keyword.toLowerCase()));
      
      if (isSensitive) {
        // Case-insensitive verification against the central configuration Set
        const isRegistered = Array.from(BRANCH_ISOLATED_MODELS).some(
          m => m.toLowerCase() === lowerModel
        );
        
        if (!isRegistered) {
          throw new Error(
            `🚨 SECURITY COMPLIANCE ERROR: Prisma model "${model}" contains a branch-sensitive domain keyword, but is NOT registered in "src/config/branchIsolation.js". Please register it to enforce strict logical isolation.`
          );
        }
      }
    });
  });
});
