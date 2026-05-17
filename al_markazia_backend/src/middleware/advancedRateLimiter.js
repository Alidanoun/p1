const logger = require('../utils/logger');
const { trackCheck } = require('../utils/metrics');

// ✅ 1️⃣ Hardened Lua Script against Key Enumeration
const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local maxRequests = tonumber(ARGV[1])
  local windowSecs = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local requestId = ARGV[4]  -- Unique identifier for request tracing auditing
  
  -- Prevent Enumeration: Conceal detailed boundary counts upon active rejections
  local current = redis.call('GET', key)
  
  if not current then
    redis.call('SET', key, '1', 'EX', windowSecs)
    return { 1, 1 }
  end
  
  local count = tonumber(current)
  
  if count >= maxRequests then
    -- Return bare denial signal concealing live differential increments
    return { 0, count }
  end
  
  local newCount = redis.call('INCR', key)
  return { 1, newCount }
`;

// 🛡️ Ultra-strict short-window local fallback map for Auth endpoints during Redis outage
const fallbackMemoryLimiter = new Map();
const fallbackMemoryCleanup = setInterval(() => fallbackMemoryLimiter.clear(), 60000);
if (fallbackMemoryCleanup.unref) {
  fallbackMemoryCleanup.unref();
}

class DistributedRateLimiter {
  constructor(options = {}) {
    this.scope = options.scope || 'global';
    
    // Resolve Redis interface supporting test mocking overrides cleanly
    this.redis = options.redis || (process.env.NODE_ENV !== 'test' ? require('../lib/redis') : null);

    this.config = {
      windowMs: options.windowMs || 60000,
      maxRequests: options.maxRequests || 100,
      keyPrefix: options.keyPrefix || `ratelimit:${this.scope}:`,
      errorMessage: options.errorMessage || 'RATE_LIMIT_EXCEEDED',
      retryAfterHeader: options.retryAfterHeader !== false,
      keyBuilder: options.keyBuilder || null,
      draftBypassEnabled: options.draftBypassEnabled || false
    };

    this.whitelist = new Set(options.whitelist || []);
  }

  // ✅ 2️⃣ Key Naming Strategy & Compression
  _compressIPv6(ip) {
    if (!ip) return 'unknown';
    // Simplified standard compression
    return ip.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3').replace(/:{3,}/, '::');
  }

  _normalizeIP(ip) {
    if (!ip) return 'unknown';
    const forwarded = ip.split(',')[0].trim();
    return forwarded.includes(':') ? this._compressIPv6(forwarded) : forwarded;
  }

  _normalizeEndpoint(path) {
    if (!path) return 'global';
    return path.replace(/\/+/g, ':').replace(/^:|:$/g, '') || 'root';
  }

  _buildKey(req) {
    if (typeof this.config.keyBuilder === 'function') {
      const customKey = this.config.keyBuilder(req);
      return customKey.startsWith(this.config.keyPrefix) ? customKey : `${this.config.keyPrefix}${customKey}`;
    }

    const userId = req.user?.id || req.user?.uuid;
    const ip = this._normalizeIP(req.ip || req.connection?.remoteAddress);
    const endpoint = this._normalizeEndpoint(req.route?.path || req.path);

    if (userId) {
      return `${this.config.keyPrefix}user:${userId}:${endpoint}`;
    }
    return `${this.config.keyPrefix}ip:${ip}:${endpoint}`;
  }

  async _checkLimit(key, req = null) {
    const now = Date.now();
    const windowSecs = Math.ceil(this.config.windowMs / 1000);
    const requestId = req?.headers?.['x-request-id'] || `req-${Math.random().toString(36).substr(2, 6)}`;

    let timerId;
    try {
      if (!this.redis || typeof this.redis.eval !== 'function') {
        throw new Error('Redis Client Unavailable');
      }

      // 🛡️ Bounded Execution: Prevent execution layer hang if eval stalls over 500ms
      const evalPromise = this.redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        this.config.maxRequests,
        windowSecs,
        now,
        requestId
      );
      
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('Execution Timeout')), 500);
      });

      const [allowed, currentCount] = await Promise.race([evalPromise, timeoutPromise]);
      clearTimeout(timerId); // ✅ Clean up active timer immediately on success!

      const isAllowed = allowed === 1;
      const result = {
        allowed: isAllowed,
        current: currentCount,
        remaining: isAllowed ? Math.max(0, this.config.maxRequests - currentCount) : 0,
        resetAt: now + this.config.windowMs,
        fallback: false
      };

      trackCheck(this.scope, isAllowed, false, req);
      return result;
    } catch (error) {
      clearTimeout(timerId); // ✅ Clean up active timer on error as well!

      if (logger && typeof logger.error === 'function') {
        logger.error('[RateLimiter] Redis cluster anomaly during threshold evaluation', { error: error.message, key, scope: this.scope });
      }

      // 🔴 STRICT ROUTE-SPECIFIC DEGRADATION: Never fail open freely on authentication/uploads
      if (this.scope === 'auth' || this.scope === 'upload') {
        const fallbackCount = (fallbackMemoryLimiter.get(key) || 0) + 1;
        fallbackMemoryLimiter.set(key, fallbackCount);
        
        // Tight local limit: Max 2 requests per minute for auth endpoints during degraded outage
        const strictMax = this.scope === 'auth' ? 2 : 5;
        const isAllowed = fallbackCount <= strictMax;
        
        const fallbackResult = {
          allowed: isAllowed,
          current: fallbackCount,
          remaining: isAllowed ? strictMax - fallbackCount : 0,
          resetAt: now + 60000,
          fallback: true
        };
        trackCheck(this.scope, isAllowed, true, req);
        return fallbackResult;
      }

      // 🟢 Safe Fail-Open for pure read APIs / search
      const fallbackResult = {
        allowed: true,
        current: 0,
        remaining: this.config.maxRequests,
        resetAt: now + this.config.windowMs,
        fallback: true
      };

      trackCheck(this.scope, true, true, req);
      return fallbackResult;
    }
  }

  middleware() {
    const fn = async (req, res, next) => {
      try {
        // Whitelist checks
        const normalizedIp = this._normalizeIP(req.ip);
        if (this.whitelist.has(normalizedIp) || 
            (req.user && this.whitelist.has(`user:${req.user.id}`))) {
          return next();
        }

        // Draft Bypass Support for load verification integration
        if (this.config.draftBypassEnabled && req.headers['x-draft-bypass'] === 'true') {
          return next();
        }

        // Internal bypass for localhost loopbacks
        if (normalizedIp === '127.0.0.1' || normalizedIp === '::1' || normalizedIp === '::ffff:127.0.0.1') {
          return next();
        }

        const key = this._buildKey(req);
        const result = await this._checkLimit(key, req);

        // Populate Granular Observability Headers
        res.set('X-RateLimit-Limit', String(this.config.maxRequests));
        res.set('X-RateLimit-Remaining', String(result.remaining));
        res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

        if (this.config.retryAfterHeader && !result.allowed) {
          const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
          res.set('Retry-After', String(retryAfter));
        }

        if (!result.allowed) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn('[RateLimiter] Distributed threshold violation blocked', {
              key,
              ip: req.ip,
              scope: this.scope,
              userId: req.user?.id,
              current: result.current,
              max: this.config.maxRequests
            });
          }

          return res.status(429).json({
            success: false,
            error: this.config.errorMessage,
            message: 'تجاوزت عدد الطلبات المسموح به. يرجى المحاولة لاحقاً.',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
          });
        }

        req.rateLimit = result;
        next();
      } catch (err) {
        if (logger && typeof logger.error === 'function') {
          logger.error('[RateLimiter] Middleware layer unexpected error', { error: err.message, path: req.path });
        }
        next(); // Fail-open absolute continuation
      }
    };

    // Attach class handle and properties to proxy compatibility
    fn.limiterInstance = this;
    return fn;
  }
}

// ✅ Factory creation pipeline helper
const createLimiter = (options) => new DistributedRateLimiter(options).middleware();

// Presets representing legacy mappings alongside state-of-the-art configurations
const refreshTokenLimiter = createLimiter({
  scope: 'auth',
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  keyPrefix: 'rl:refresh:',
  errorMessage: 'كثرة محاولات تجديد الجلسة، يرجى الانتظار'
});

const loginLimiter = createLimiter({
  scope: 'auth',
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'rl:login:',
  errorMessage: 'كثرة محاولات تسجيل الدخول، يرجى الانتظار 15 دقيقة',
  keyBuilder: (req) => {
    const email = req.body?.email || 'unknown';
    return `login:${req.ip}:${email}`;
  }
});

const otpLimiter = createLimiter({
  scope: 'auth',
  windowMs: 10 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'rl:otp:',
  errorMessage: 'كثرة طلبات رمز التحقق، يرجى الانتظار 10 دقائق',
  keyBuilder: (req) => {
    const email = req.body?.email || 'unknown';
    return `otp:${email}:${req.ip}`;
  }
});

const apiLimiter = createLimiter({
  scope: 'api',
  windowMs: 60 * 1000,
  maxRequests: 200,
  keyPrefix: 'rl:api:',
  errorMessage: 'كثرة الطلبات، يرجى الانتظار قليلاً'
});

const uploadLimiter = createLimiter({
  scope: 'upload',
  windowMs: 60 * 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'rl:upload:',
  errorMessage: 'تجاوزت حد التحميلات المسموح'
});

// Expose presets table mapping
const limiters = {
  auth: createLimiter({
    scope: 'auth',
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'ratelimit:auth:',
    errorMessage: 'AUTH_RATE_LIMIT_EXCEEDED'
  }),
  orders: createLimiter({
    scope: 'orders',
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'ratelimit:orders:',
    errorMessage: 'ORDER_RATE_LIMIT_EXCEEDED'
  }),
  search: createLimiter({
    scope: 'search',
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: 'ratelimit:search:',
    errorMessage: 'SEARCH_RATE_LIMIT_EXCEEDED'
  }),
  api: apiLimiter
};

module.exports = {
  DistributedRateLimiter,
  createLimiter,
  limiters,
  refreshTokenLimiter,
  loginLimiter,
  otpLimiter,
  apiLimiter,
  uploadLimiter
};
