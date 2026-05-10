const logger = require('./logger');

/**
 * 🛠️ Stabilization Logging Layer (Phase 0)
 * Provides centralized logging for critical stabilization targets.
 */
class StabilizationLogger {
  
  static logRequest(req, res, metadata = {}) {
    if (req.method === 'GET' && !req.originalUrl.includes('admin')) return;
    
    logger.http(`[REQ] ${req.method} ${req.originalUrl}`, {
      userId: req.user?.id,
      role: req.user?.role,
      ip: req.ip,
      statusCode: res.statusCode,
      ...metadata
    });
  }

  static logFinancial(action, amount, context = {}) {
    logger.financial(`${action} - Amount: ${amount}`, {
      ...context,
      type: 'FINANCIAL_TRACKING'
    });
  }

  static logCancellation(orderId, reason, actor = {}) {
    logger.cancellation(`Order ${orderId} - Reason: ${reason}`, {
      orderId,
      actorId: actor.id,
      actorRole: actor.role,
      type: 'CANCELLATION_TRACKING'
    });
  }

  static logSocket(event, payload, context = {}) {
    logger.socket(`Event: ${event}`, {
      ...context,
      payloadSize: JSON.stringify(payload || {}).length,
      type: 'SOCKET_SYNC_TRACKING'
    });
  }

  static logApproval(approvalId, action, actor = {}) {
    logger.approval(`${action} for ID: ${approvalId}`, {
      approvalId,
      actorId: actor.id,
      actorRole: actor.role,
      type: 'APPROVAL_TRACKING'
    });
  }
}

module.exports = StabilizationLogger;
