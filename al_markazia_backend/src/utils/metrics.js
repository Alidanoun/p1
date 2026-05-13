/**
 * 📊 Unified Rate Limiting Observability Metrics
 * Tracks check counters, fallback behaviors, distribution per scope, and blocked entity profiles.
 */

const rateLimitMetrics = {
  checks: {
    total: 0,
    allowed: 0,
    rejected: 0,
    fallback: 0
  },
  by_scope: {
    auth: { allowed: 0, rejected: 0 },
    orders: { allowed: 0, rejected: 0 },
    guest_orders: { allowed: 0, rejected: 0 },
    search: { allowed: 0, rejected: 0 },
    reviews: { allowed: 0, rejected: 0 },
    api: { allowed: 0, rejected: 0 },
    global: { allowed: 0, rejected: 0 }
  },
  by_user_type: {
    authenticated: { allowed: 0, rejected: 0 },
    guest: { allowed: 0, rejected: 0 },
    admin: { allowed: 0, rejected: 0 }
  },
  top_blocked_ips: new Map() // Tracks repeated abusers
};

const trackCheck = (scope, isAllowed, isFallback, req) => {
  rateLimitMetrics.checks.total++;
  
  if (isFallback) {
    rateLimitMetrics.checks.fallback++;
  } else if (isAllowed) {
    rateLimitMetrics.checks.allowed++;
  } else {
    rateLimitMetrics.checks.rejected++;
  }

  // Ensure dynamic scope defaults
  const targetScope = scope || 'global';
  if (!rateLimitMetrics.by_scope[targetScope]) {
    rateLimitMetrics.by_scope[targetScope] = { allowed: 0, rejected: 0 };
  }

  if (isAllowed) {
    rateLimitMetrics.by_scope[targetScope].allowed++;
  } else {
    rateLimitMetrics.by_scope[targetScope].rejected++;
  }

  // Track User Identity Type
  let userType = 'guest';
  if (req && req.user) {
    userType = req.user.role === 'admin' ? 'admin' : 'authenticated';
  }

  if (isAllowed) {
    rateLimitMetrics.by_user_type[userType].allowed++;
  } else {
    rateLimitMetrics.by_user_type[userType].rejected++;
    
    // Increment Blocked IP Registry
    if (req && req.ip) {
      const ip = req.ip.split(',')[0].trim();
      const currentHits = rateLimitMetrics.top_blocked_ips.get(ip) || 0;
      rateLimitMetrics.top_blocked_ips.set(ip, currentHits + 1);
    }
  }
};

const getRateLimitMetrics = () => {
  // Convert map to plain top blocked summary
  const topBlocked = Array.from(rateLimitMetrics.top_blocked_ips.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([ip, count]) => ({ ip, count }));

  return {
    ...rateLimitMetrics,
    top_blocked_ips: topBlocked
  };
};

const resetMetrics = () => {
  rateLimitMetrics.checks = { total: 0, allowed: 0, rejected: 0, fallback: 0 };
  Object.keys(rateLimitMetrics.by_scope).forEach(s => {
    rateLimitMetrics.by_scope[s] = { allowed: 0, rejected: 0 };
  });
  Object.keys(rateLimitMetrics.by_user_type).forEach(t => {
    rateLimitMetrics.by_user_type[t] = { allowed: 0, rejected: 0 };
  });
  rateLimitMetrics.top_blocked_ips.clear();
  
  loyaltyMetrics.calculations_total = 0;
  loyaltyMetrics.rounding_adjustments = 0;
  loyaltyMetrics.negative_balance_prevented = 0;
  loyaltyMetrics.tier_upgrades_processed = 0;
};

const loyaltyMetrics = {
  calculations_total: 0,
  rounding_adjustments: 0,
  negative_balance_prevented: 0,
  tier_upgrades_processed: 0
};

const trackLoyaltyCalculation = (isAdjusted = false) => {
  loyaltyMetrics.calculations_total++;
  if (isAdjusted) loyaltyMetrics.rounding_adjustments++;
};

const trackNegativeBalancePrevented = () => {
  loyaltyMetrics.negative_balance_prevented++;
};

const trackTierUpgrade = () => {
  loyaltyMetrics.tier_upgrades_processed++;
};

module.exports = {
  rateLimitMetrics,
  trackCheck,
  getRateLimitMetrics,
  resetMetrics,
  loyaltyMetrics,
  trackLoyaltyCalculation,
  trackNegativeBalancePrevented,
  trackTierUpgrade
};
