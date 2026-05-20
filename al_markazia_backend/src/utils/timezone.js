const prisma = require('../lib/prisma');
const nodeCache = require('../lib/memoryCache');
const { DEFAULT_TIMEZONE } = require('../config/constants');
const logger = require('./logger');

/**
 * getTimezone - Single Source of Truth for timezone resolution
 * 
 * @param {string|number|null} branchId 
 * @returns {Promise<string>} The resolved timezone
 */
async function getTimezone(branchId = null) {
  try {
    if (branchId && branchId !== 'all' && branchId !== 'null' && branchId !== 'undefined') {
      const cacheKey = `tz_branch_${branchId}`;
      const cached = nodeCache.get(cacheKey);
      if (cached) return cached;
      
      const branch = await prisma.branch.findUnique({
        where: { id: typeof branchId === 'string' ? parseInt(branchId) : branchId },
        select: { timezone: true }
      });
      
      if (branch?.timezone) {
        nodeCache.set(cacheKey, branch.timezone, 300); // 5 mins cache
        return branch.timezone;
      }
    }

    // Fallback to global settings
    const cacheKey = 'tz_global';
    const cached = nodeCache.get(cacheKey);
    if (cached) return cached;

    const settings = await prisma.restaurantSettings.findFirst({ select: { timezone: true } });
    const tz = settings?.timezone || DEFAULT_TIMEZONE;
    nodeCache.set(cacheKey, tz, 300); // 5 mins cache
    return tz;
  } catch (err) {
    logger.warn('[TimezoneHelper] Failed to fetch timezone, falling back to DEFAULT_TIMEZONE', { error: err.message });
    return DEFAULT_TIMEZONE;
  }
}

/**
 * getTimezoneSync - Fast synchronous fallback for memory projections.
 * ONLY use this if you are inside a synchronous loop that cannot be refactored to async.
 * It will try to use the cache, otherwise it returns DEFAULT_TIMEZONE immediately.
 */
function getTimezoneSync(branchId = null) {
  if (branchId && branchId !== 'all' && branchId !== 'null' && branchId !== 'undefined') {
    const cached = nodeCache.get(`tz_branch_${branchId}`);
    if (cached) return cached;
  }
  const globalCached = nodeCache.get('tz_global');
  if (globalCached) return globalCached;
  
  return DEFAULT_TIMEZONE;
}

module.exports = { 
  getTimezone,
  getTimezoneSync 
};
