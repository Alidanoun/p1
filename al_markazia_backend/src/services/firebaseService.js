const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Initialize Firebase Admin with the service account file
const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');
let fcmEnabled = false;

try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    fcmEnabled = true;
    logger.info('🚀 Firebase Admin SDK initialized successfully.');
  } else {
    logger.warn('⚠️ Firebase service account file NOT FOUND. FCM notifications are DISABLED.');
    logger.warn(`Expected path: ${serviceAccountPath}`);
  }
} catch (error) {
  logger.error('❌ Failed to initialize Firebase Admin SDK:', { error: error.message });
}

/**
 * Sends a push notification to a specific device token.
 */
const sendToToken = async (token, title, body, data = {}) => {
  if (!fcmEnabled || !token) {
    if (!fcmEnabled) logger.error('[FCM] Push skipped: Firebase Admin NOT initialized.');
    return false;
  }
  
  const stringData = {};
  Object.keys(data).forEach(key => {
    stringData[key] = String(data[key]);
  });

  const message = {
    notification: { title, body }, // 🔥 Hybrid: OS-level alerts
    data: stringData,              // 🔥 Structured: App-level logic
    token: token,
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

  try {
    const response = await admin.messaging().send(message);
    logger.info('[FCM] Sent successfully 🚀', { responseId: response, notificationId: data.notificationId });
    return true;
  } catch (error) {
    logger.error('[FCM] Send Error ❌', { error: error.message, token: token.substring(0, 10) });
    return false;
  }
};

/**
 * Sends a broadcast message to all users.
 */
const sendBroadcast = async (title, body, data = {}) => {
  if (!fcmEnabled) return null;

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

  try {
    const response = await admin.messaging().send(message);
    logger.info('FCM Broadcast sent successfully', { response });
    return response;
  } catch (error) {
    logger.error('FCM Broadcast Error', { error: error.message });
    return null;
  }
};

/**
 * Sends a notification to a specific FCM topic.
 */
const sendToTopic = async (topic, title, body, data = {}) => {
  if (!fcmEnabled) return null;

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

  try {
    const response = await admin.messaging().send(message);
    logger.info(`FCM Topic message sent successfully to: ${topic}`, { response });
    return response;
  } catch (error) {
    logger.error(`FCM Topic message Error [${topic}]`, { error: error.message });
    return null;
  }
};

module.exports = { admin, sendToToken, sendBroadcast, sendToTopic, isFcmEnabled: () => fcmEnabled };
