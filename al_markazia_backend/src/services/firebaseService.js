const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

// Initialize Firebase Admin with the service account file
const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

/**
 * Sends a push notification to a specific device token.
 */
const sendToToken = async (token, title, body, data = {}) => {
  if (!token) return;
  
  // Ensure all data values are strings (required by FCM)
  const stringData = {};
  Object.keys(data).forEach(key => {
    stringData[key] = String(data[key]);
  });

  const message = {
    notification: { title, body },
    data: stringData,
    token: token,
    android: {
      priority: 'high',
      notification: {
        channelId: 'almarkazia_channel',
        priority: 'high',
      }
    }
  };

  logger.debug('[FCM] Dispatching message', { 
    token: token.slice(0, 15) + '...',
    title, 
    body,
    channelId: 'almarkazia_channel'
  });

  try {
    const response = await admin.messaging().send(message);
    logger.info('[FCM] Sent successfully 🚀', { 
      responseId: response, 
      token: token.slice(0, 15) + '...' 
    });
    return true;
  } catch (error) {
    logger.error('[FCM] Send Error ❌', { 
      error: error.message, 
      errorCode: error.code,
      token: token.slice(0, 15) + '...' 
    });
    return false;
  }
};

/**
 * Sends a broadcast message to all users subscribed to the 'all_users' topic.
 */
const sendBroadcast = async (title, body, data = {}) => {
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
      notification: {
        channelId: 'almarkazia_channel',
        priority: 'high',
        sound: 'default',
      }
    },
    apns: {
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          badge: 1,
          contentAvailable: true,
        }
      }
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
      notification: {
        channelId: 'almarkazia_channel',
        priority: 'high',
        sound: 'default'
      }
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

module.exports = { admin, sendToToken, sendBroadcast, sendToTopic };
