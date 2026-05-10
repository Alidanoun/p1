const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');
const { fcmBreaker } = require('../middleware/notificationCircuitBreaker');

// ⚙️ Advanced FCM Configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000; // 1 second

// 📊 Delivery Metrics (Real-time tracking)
const metrics = {
  sent: 0,
  failed: 0,
  retried: 0,
  invalidTokensRemoved: 0,
  circuitBreakerOpens: 0,
  lastReset: new Date(),
  byType: {} // Track counts by event type
};

const getMetrics = () => ({
  ...metrics,
  successRate: metrics.sent > 0 ? ((metrics.sent / (metrics.sent + metrics.failed)) * 100).toFixed(2) + '%' : '0%'
});

const resetMetrics = () => {
  metrics.sent = 0;
  metrics.failed = 0;
  metrics.retried = 0;
  metrics.invalidTokensRemoved = 0;
  metrics.circuitBreakerOpens = 0;
  metrics.lastReset = new Date();
  metrics.byType = {};
};

// Initialize Firebase Admin with Fallback Logic
const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');
let fcmEnabled = false;

const initFirebase = () => {
  try {
    // Priority 1: Service Account JSON File
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      fcmEnabled = true;
      logger.info('🚀 [FCM Engine] Firebase Admin SDK initialized via JSON file.');
      return;
    }

    // Priority 2: Environment Variables (Fail-safe for CI/CD or Docker)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        })
      });
      fcmEnabled = true;
      logger.info('🚀 [FCM Engine] Firebase Admin SDK initialized via Environment Variables.');
      return;
    }

    logger.warn('⚠️ [FCM Engine] No Firebase credentials found. FCM notifications are DISABLED.');
  } catch (error) {
    logger.error('❌ [FCM Engine] Failed to initialize Firebase Admin SDK:', { error: error.message });
  }
};

initFirebase();

/**
 * 🛡️ Private: Guaranteed Delivery Logic with Exponential Backoff
 */
const _sendWithRetry = async (message, notificationId, eventType = 'unknown', attempt = 1) => {
  if (!fcmEnabled) return null;

  try {
    // ⚡ [PHASE 1] Circuit Breaker Protection
    const responseId = await fcmBreaker.fire(
      async (msg) => await admin.messaging().send(msg), 
      message
    );
    
    metrics.sent++;
    if (eventType) {
      metrics.byType[eventType] = (metrics.byType[eventType] || 0) + 1;
    }
    logger.info('[FCM Delivery] ✅ Success', { 
      messageId: responseId, 
      notificationId, 
      attempt 
    });
    return responseId;
  } catch (error) {
    metrics.failed++;
    const errorCode = error.code;
    const isNetworkError = [
      'messaging/internal-error',
      'messaging/server-unavailable',
      'messaging/mismatched-credential'
    ].includes(errorCode);

    const isInvalidToken = [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token'
    ].includes(errorCode);

    logger.error('[FCM Delivery] ❌ Attempt Failed', { 
      notificationId, 
      attempt, 
      errorCode, 
      error: error.message,
      token: message.token ? `${message.token.substring(0, 10)}...` : 'N/A'
    });

    // 1. Handle Stale/Dead Tokens (Cleanup)
    if (isInvalidToken && message.token) {
      await _cleanupInvalidToken(message.token);
      return null; // Stop retrying for dead tokens
    }

    // 2. Exponential Backoff for Network/Temporary Errors
    if (isNetworkError && attempt < MAX_RETRIES) {
      metrics.retried++;
      const delay = INITIAL_BACKOFF * Math.pow(2, attempt - 1);
      logger.warn(`[FCM Retry] ⏳ Retrying in ${delay}ms...`, { notificationId, nextAttempt: attempt + 1 });
      await new Promise(resolve => setTimeout(resolve, delay));
      return _sendWithRetry(message, notificationId, attempt + 1);
    }

    return null; // Terminal failure
  }
};

/**
 * 🧹 Private: Automatic Token Hygiene
 */
const _cleanupInvalidToken = async (token) => {
  try {
    const prisma = require('../lib/prisma');
    logger.warn('🧹 [FCM Hygiene] Removing invalid token from database...', { tokenPrefix: token.substring(0, 10) });
    await prisma.customer.updateMany({
      where: { fcmToken: token },
      data: { fcmToken: null }
    });
    metrics.invalidTokensRemoved++;
  } catch (e) {
    logger.error('[FCM Hygiene] ❌ Database cleanup failed', { error: e.message });
  }
};

/**
 * 📡 Sends a push notification to a specific device token (Refactored V5)
 */
const sendToToken = async (token, title, body, data = {}) => {
  if (!fcmEnabled || !token) {
    if (!fcmEnabled) logger.error('[FCM Engine] Push skipped: Firebase Admin NOT initialized.');
    return false;
  }
  
  const notificationId = data.notificationId || 'N/A';
  const stringData = {};
  Object.keys(data).forEach(key => {
    stringData[key] = String(data[key]);
  });

  const decryptedToken = decrypt(token);

  const message = {
    notification: { title, body },
    data: stringData,
    token: decryptedToken,
    android: {
      priority: 'high',
      notification: {
        channelId: 'almarkazia_channel',
        priority: 'high',
        sound: 'default',
        visibility: 'public'
      }
    },
    apns: {
      payload: {
        aps: { sound: 'default', badge: 1 }
      }
    }
  };

  const result = await _sendWithRetry(message, notificationId, data.type || 'direct');
  return result !== null;
};

/**
 * 📡 Sends a broadcast message to all users (Refactored V5)
 */
const sendBroadcast = async (title, body, data = {}) => {
  if (!fcmEnabled) return null;

  const notificationId = data.notificationId || 'BROADCAST';
  const stringData = {};
  Object.keys(data).forEach(key => {
    stringData[key] = String(data[key]);
  });

  const message = {
    notification: { title, body },
    data: stringData,
    topic: 'all_users',
    android: {
      priority: 'high',
      notification: { channelId: 'almarkazia_channel', priority: 'high', sound: 'default' }
    }
  };

  const result = await _sendWithRetry(message, notificationId, 'broadcast');
  return result !== null;
};

/**
 * 📡 Sends a notification to a specific FCM topic (Refactored V5)
 */
const sendToTopic = async (topic, title, body, data = {}) => {
  if (!fcmEnabled) return null;

  const notificationId = data.notificationId || `TOPIC:${topic}`;
  const stringData = {};
  Object.keys(data).forEach(key => {
    stringData[key] = String(data[key]);
  });

  const message = {
    notification: { title, body },
    data: stringData,
    topic: topic,
    android: {
      priority: 'high',
      notification: { channelId: 'almarkazia_channel', priority: 'high', sound: 'default' }
    }
  };

  const result = await _sendWithRetry(message, notificationId, `topic:${topic}`);
  return result !== null;
};

module.exports = { 
  admin, 
  sendToToken, 
  sendBroadcast, 
  sendToTopic, 
  isFcmEnabled: () => fcmEnabled,
  getMetrics
};
