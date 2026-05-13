const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');
const { Sentry } = require('../config/sentry');
const prisma = require('../lib/prisma');
const xss = require('xss');

/**
 * 🌟 Enterprise Firebase Cloud Messaging Service
 * Implements bilingual payload builders, guaranteed retry policies, hygienic token tracking,
 * and comprehensive observability hooks.
 */
class FirebaseService {
  constructor() {
    // 🛡️ Required properties preserved exactly
    this.maxRetries = 3;
    this.retryDelay = 1000;
    
    this.fcmEnabled = false;
    this.metrics = {
      sent: 0,
      failed: 0,
      retried: 0,
      invalidTokensRemoved: 0,
      byType: {}
    };

    // Bilingual localization mapping dictionary
    this.templates = {
      order_created: {
        ar: { title: 'طلب جديد 📦', body: 'تم استلام طلبك بنجاح وهو قيد المراجعة.' },
        en: { title: 'Order Created 📦', body: 'Your order has been received successfully and is under review.' }
      },
      order_ready: {
        ar: { title: 'طلبك جاهز! 🍽️', body: 'طلبك جاهز الآن للاستلام أو التوصيل.' },
        en: { title: 'Order Ready! 🍽️', body: 'Your order is now ready for pickup or delivery.' }
      },
      order_delivered: {
        ar: { title: 'تم التوصيل ✔️', body: 'تم توصيل طلبك بنجاح. نتمنى لك وجبة شهية!' },
        en: { title: 'Order Delivered ✔️', body: 'Your order has been delivered successfully. Enjoy your meal!' }
      },
      payment_received: {
        ar: { title: 'تأكيد الدفع 💰', body: 'تم استلام الدفعة الخاصة بطلبك بنجاح.' },
        en: { title: 'Payment Received 💰', body: 'Payment for your order has been received successfully.' }
      }
    };

    this.initialize();
  }

  /**
   * 1. Required method: initialize()
   * Bootstraps Firebase Admin credentials securely.
   */
  initialize() {
    try {
      if (admin.apps.length > 0) {
        this.fcmEnabled = true;
        return;
      }

      const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');
      
      // Check physical file credential source
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        this.fcmEnabled = true;
        logger.info('🚀 [FCM Engine] Firebase initialized via physical JSON mapping.');
        return;
      }

      // Check environment inject source
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL
          })
        });
        this.fcmEnabled = true;
        logger.info('🚀 [FCM Engine] Firebase initialized via Environment configuration variables.');
        return;
      }

      logger.warn('⚠️ [FCM Engine] Missing credentials. Push notifications transport disabled.');
    } catch (error) {
      logger.error('❌ [FCM Engine] Bootstrap exception encountered:', { error: error.message });
      if (Sentry) Sentry.captureException(error);
    }
  }

  /**
   * Translates standardized event payloads into localized structures.
   */
  _buildPayload(type, lang = 'ar', customTitle = null, customBody = null) {
    const safeLang = ['ar', 'en'].includes(lang) ? lang : 'ar';
    const cleanTitle = customTitle ? xss(String(customTitle), { whiteList: {} }) : null;
    const cleanBody = customBody ? xss(String(customBody), { whiteList: {} }) : null;

    const template = this.templates[type]?.[safeLang] || {
      title: cleanTitle || 'تنبيه النظام 🔔',
      body: cleanBody || 'لديك إشعار جديد في حسابك.'
    };

    return {
      title: cleanTitle || template.title,
      body: cleanBody || template.body
    };
  }

  /**
   * 🛡️ Deep execution wrapping handling temporary backoffs and error parsing.
   */
  async _executeWithRetry(messagePayload, logRecordId = null, attempt = 1) {
    if (!this.fcmEnabled) return null;

    try {
      const responseId = await admin.messaging().send(messagePayload);
      this.metrics.sent++;

      // Update Database Persistence status to SENT
      if (logRecordId) {
        await prisma.notificationLog.updateMany({
          where: { id: logRecordId },
          data: { status: 'SENT', messageId: responseId, sentAt: new Date() }
        }).catch(() => {});
      }

      logger.info('[FCM Delivery] ✅ Verified push success', { responseId, attempt });
      return responseId;
    } catch (error) {
      const errorCode = error.code || '';
      logger.error('[FCM Delivery] ❌ Error executing transmission', { errorCode, message: error.message, attempt });

      // Track failure
      this.metrics.failed++;
      if (logRecordId) {
        await prisma.notificationLog.updateMany({
          where: { id: logRecordId },
          data: { status: 'FAILED', error: error.message }
        }).catch(() => {});
      }

      // Check Terminal Tokens for deletion
      const isInvalidToken = [
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered'
      ].includes(errorCode);

      if (isInvalidToken && messagePayload.token) {
        await this._removeStaleToken(messagePayload.token);
        return null;
      }

      // Check network backoff feasibility
      const isTemporaryFailure = [
        'messaging/internal-error',
        'messaging/server-unavailable',
        'messaging/too-many-requests'
      ].includes(errorCode);

      if (isTemporaryFailure && attempt < this.maxRetries) {
        this.metrics.retried++;
        const backoffWindow = this.retryDelay * Math.pow(2, attempt - 1);
        logger.warn(`[FCM Backoff] ⏳ Intercepted temporary failure. Retrying transmission in ${backoffWindow}ms...`, { attempt });
        
        await new Promise(resolve => setTimeout(resolve, backoffWindow));
        return this._executeWithRetry(messagePayload, logRecordId, attempt + 1);
      }

      // Notify Sentry on critical transmission drop
      if (Sentry) {
        Sentry.captureException(error, { extra: { payload: messagePayload, attempt } });
      }

      return null;
    }
  }

  /**
   * Removes stale or untracked FCM registration tokens to optimize downstream load.
   */
  async _removeStaleToken(token) {
    try {
      logger.warn('🧹 [FCM Hygiene] Purging invalid downstream registration token from accounts persistence.');
      await prisma.user.updateMany({
        where: { fcmToken: token },
        data: { fcmToken: null }
      }).catch(() => {});

      await prisma.customer.updateMany({
        where: { fcmToken: token },
        data: { fcmToken: null }
      }).catch(() => {});

      this.metrics.invalidTokensRemoved++;
    } catch (err) {
      logger.error('Token purge exception:', { error: err.message });
    }
  }

  /**
   * 2. Required method: sendNotification()
   * Dispatches tailored single destination payloads.
   */
  async sendNotification({ token, type, userId = null, lang = 'ar', customTitle = null, customBody = null, data = {} }) {
    if (!token) return null;

    // Resolve localized strings
    const { title, body } = this._buildPayload(type, lang, customTitle, customBody);

    // Ensure all strings in data object map directly and are safely sanitized
    const stringData = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(k => {
        stringData[k] = xss(String(data[k]), { whiteList: {} });
      });
    }

    // Persist NotificationLog record in initial state
    let logRecordId = null;
    try {
      const createdLog = await prisma.notificationLog.create({
        data: {
          userId: userId ? String(userId) : null,
          type: type || 'custom',
          title,
          body,
          status: 'PENDING'
        }
      });
      logRecordId = createdLog.id;
    } catch (e) {
      logger.error('Failed to log notification persistence payload', { error: e.message });
    }

    // Attempt secure transmission
    const messagePayload = {
      notification: { title, body },
      data: stringData,
      token: token.includes(':') ? decrypt(token) : token,
      android: { priority: 'high' }
    };

    // Run non-blocking to protect incoming application lifecycle workflows
    return await this._executeWithRetry(messagePayload, logRecordId);
  }

  /**
   * 3. Required method: sendMulticastNotification()
   * Dispatches payloads efficiently across dynamic target collections.
   */
  async sendMulticastNotification({ tokens = [], type, lang = 'ar', customTitle = null, customBody = null, data = {} }) {
    if (!tokens || tokens.length === 0 || !this.fcmEnabled) return { successCount: 0, failureCount: 0 };

    const { title, body } = this._buildPayload(type, lang, customTitle, customBody);
    const stringData = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(k => { stringData[k] = xss(String(data[k]), { whiteList: {} }); });
    }

    const cleanTokens = tokens.map(t => t.includes(':') ? decrypt(t) : t).filter(Boolean);

    const messagePayload = {
      notification: { title, body },
      data: stringData,
      tokens: cleanTokens
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(messagePayload);
      this.metrics.sent += response.successCount;
      this.metrics.failed += response.failureCount;

      // Scan failures to enforce token hygiene
      if (response.failureCount > 0) {
        response.responses.forEach(async (resp, idx) => {
          if (!resp.success && resp.error) {
            const errCode = resp.error.code;
            if (['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(errCode)) {
              await this._removeStaleToken(cleanTokens[idx]);
            }
          }
        });
      }

      return { successCount: response.successCount, failureCount: response.failureCount };
    } catch (error) {
      logger.error('Multicast engine failed execution', { error: error.message });
      if (Sentry) Sentry.captureException(error);
      return { successCount: 0, failureCount: tokens.length };
    }
  }

  /**
   * 4. Required method: sendToTopic()
   * Pushes updates broadly across logical subscription partitions.
   */
  async sendToTopic(topic, { type, lang = 'ar', customTitle = null, customBody = null, data = {} }) {
    if (!topic || !this.fcmEnabled) return null;

    const { title, body } = this._buildPayload(type, lang, customTitle, customBody);
    const stringData = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(k => { stringData[k] = xss(String(data[k]), { whiteList: {} }); });
    }

    const messagePayload = {
      notification: { title, body },
      data: stringData,
      topic
    };

    try {
      const resp = await admin.messaging().send(messagePayload);
      this.metrics.sent++;
      return resp;
    } catch (error) {
      logger.error(`Topic push failed for destination: ${topic}`, { error: error.message });
      return null;
    }
  }

  /**
   * 5. Required method: subscribeToTopic()
   */
  async subscribeToTopic(tokens, topic) {
    if (!tokens || !topic || !this.fcmEnabled) return false;
    const list = Array.isArray(tokens) ? tokens : [tokens];
    const clean = list.map(t => t.includes(':') ? decrypt(t) : t).filter(Boolean);
    
    try {
      await admin.messaging().subscribeToTopic(clean, topic);
      return true;
    } catch (error) {
      logger.error('Topic subscription binding failure encountered', { error: error.message });
      return false;
    }
  }

  /**
   * 6. Required method: unsubscribeFromTopic()
   */
  async unsubscribeFromTopic(tokens, topic) {
    if (!tokens || !topic || !this.fcmEnabled) return false;
    const list = Array.isArray(tokens) ? tokens : [tokens];
    const clean = list.map(t => t.includes(':') ? decrypt(t) : t).filter(Boolean);
    
    try {
      await admin.messaging().unsubscribeFromTopic(clean, topic);
      return true;
    } catch (error) {
      logger.error('Topic subscription unbind failure encountered', { error: error.message });
      return false;
    }
  }
}

// Ensure single shared instance across contexts
const instance = new FirebaseService();

// Export class instance, along with legacy signature wrapper aliases to prevent runtime regressions
module.exports = {
  FirebaseService: instance,
  admin,
  // Alias wrappers mapping legacy parameters safely to internal workflows
  sendToToken: async (token, title, body, data = {}) => {
    return (await instance.sendNotification({ token, customTitle: title, customBody: body, data })) !== null;
  },
  sendBroadcast: async (title, body, data = {}) => {
    return (await instance.sendToTopic('all_users', { customTitle: title, customBody: body, data })) !== null;
  },
  sendToTopic: async (topic, title, body, data = {}) => {
    return (await instance.sendToTopic(topic, { customTitle: title, customBody: body, data })) !== null;
  },
  isFcmEnabled: () => instance.fcmEnabled,
  getMetrics: () => instance.metrics
};
