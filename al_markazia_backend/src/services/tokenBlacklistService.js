const redis = require('../lib/redis');
const logger = require('../utils/logger');

class TokenBlacklistService {
  constructor() {
    this.redis = redis;
    this.logger = logger;
    this.TTL_MULTIPLIER = 1.1; // 10% buffer
  }

  // إضافة رمز للسحب الفوري
  async blacklist(jti, userId, reason = 'REVOKED', ttlOverride = null) {
    if (!jti) return;
    const key = `blacklist:${jti}`;
    const ttl = ttlOverride || Math.ceil(
      (parseInt(process.env.ACCESS_TOKEN_TTL) || 900) * this.TTL_MULTIPLIER
    );
    
    await this.redis.setex(key, ttl, JSON.stringify({
      userId,
      reason,
      blacklistedAt: new Date().toISOString()
    }));
    
    this.logger.info('[TokenBlacklisted]', { jti, userId, reason });
  }

  // التحقق من السحب
  async isBlacklisted(jti) {
    if (!jti) return false;
    const data = await this.redis.get(`blacklist:${jti}`);
    return data !== null;
  }

  // سحب جميع جلسات المستخدم
  async blacklistUserSessions(userId, reason) {
    if (!userId) return;
    // 1. زيادة إصدار الصلاحيات في Redis وقاعدة البيانات
    await this.redis.incr(`permissionVersion:${userId}`);
    
    // 2. مسح جميع رموز المستخدم النشطة وإضافتها للقائمة السوداء
    const pattern = `session:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    
    for (const key of keys) {
      const session = await this.redis.get(key);
      if (session) {
        try {
          const parsed = JSON.parse(session);
          if (parsed && parsed.sid) {
            await this.blacklist(parsed.sid, userId, reason);
          }
        } catch (e) {
          this.logger.warn('Failed to parse session during blacklist', { key, error: e.message });
        }
      }
      await this.redis.del(key);
    }
  }
}

module.exports = new TokenBlacklistService();
