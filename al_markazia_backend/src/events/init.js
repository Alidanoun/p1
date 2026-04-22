const logger = require('../utils/logger');
const socketModule = require('../socket');

/**
 * 🚀 Central Event System Initializer
 * Ensures ALL handlers and services are properly wired to the EventBus.
 * 
 * 🛡️ RULE: No subscriptions before Socket.IO readiness.
 */
async function init() {
  logger.info('[EventSystem] 🏗️ Initializing Communication Pipeline...');

  try {
    // 1. 🛡️ WAIT FOR SOCKET READY
    // This solves the "io is null" race condition on server startup
    await socketModule.waitReady();
    logger.info('[EventSystem] ✅ Socket Layer Ready. Wiring Handlers...');

    // 2. Load Projections (Updates internal state/metrics)
    require('./handlers/orderHandlers');
    
    // 3. Load Socket Handlers (Emits real-time events)
    require('./handlers/socketHandler');
    
    // 4. Initialize Push Notification Engine (FCM + Multi-Channel Fallback)
    const notificationService = require('../services/notificationService');
    notificationService.init();

    logger.info('[EventSystem] 🚀 ALL REAL-TIME SYSTEMS ONLINE.');
  } catch (err) {
    logger.error('[EventSystem] ❌ CRITICAL: Real-time Pipeline Initialization Failed', { error: err.message });
    // In production, we might want to alert ops or retry, but for now, we log clearly.
  }
}

module.exports = { init };
