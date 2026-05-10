/**
 * @file orderStateMachine.js
 * @description محرك إدارة حالات الطلب والتحقق من سلامة الانتقالات
 */

const logger = require('../utils/logger');

// وضع التشغيل: LOG_ONLY (تسجيل فقط) أو ENFORCE (رفض صارم)
const OPERATIONAL_MODE = process.env.ORDER_STATE_MODE || 'LOG_ONLY';

const ALLOWED_TRANSITIONS = {
  'pending': ['confirmed', 'preparing', 'cancelled'],
  'confirmed': ['preparing', 'cancelled'],
  'preparing': ['ready', 'cancelled'],
  'ready': ['in_route', 'cancelled'],
  'in_route': ['delivered', 'failed', 'cancelled'],
  'delivered': [],
  'cancelled': [],
  'failed': ['in_route', 'cancelled'],
  'waiting_cancellation': ['cancelled', 'pending', 'preparing', 'ready', 'in_route', 'delivered'],
  'waiting_cancellation_admin': ['cancelled', 'pending', 'preparing', 'ready', 'in_route', 'delivered']
};

/**
 * يتحقق مما إذا كان الانتقال من الحالة الحالية إلى الحالة الجديدة مسموحاً به
 * @param {string} currentStatus - الحالة الحالية للطلب
 * @param {string} nextStatus - الحالة المطلوب الانتقال إليها
 * @returns {object} - { isValid: boolean, error: string|null }
 */
const checkTransition = (currentStatus, nextStatus) => {
  const current = currentStatus?.toLowerCase();
  const next = nextStatus?.toLowerCase();

  if (current === next) return { isValid: true };

  const allowed = ALLOWED_TRANSITIONS[current] || [];
  const isValid = allowed.includes(next);

  if (!isValid) {
    return { 
      isValid: false, 
      error: `انتقال غير مسموح به من حالة ${current} إلى ${next}` 
    };
  }

  return { isValid: true };
};

/**
 * دالة التحقق مع دعم وضع التشغيل (ENFORCE / LOG_ONLY)
 */
const validateTransition = (currentStatus, nextStatus, orderId, auditService = null, actor = null) => {
  const result = checkTransition(currentStatus, nextStatus);

  if (!result.isValid) {
    const errorMsg = `🚫 [StateMachine] Illegal Transition for Order ${orderId}: ${currentStatus} -> ${nextStatus}`;
    
    // تسجيل في الـ Audit Logs إذا توفرت الخدمة
    if (auditService && actor) {
      auditService.log({
        userId: actor.id,
        userRole: actor.role,
        action: 'ILLEGAL_STATE_TRANSITION',
        entityType: 'Order',
        entityId: orderId.toString(),
        status: 'WARNING',
        metadata: JSON.stringify({
          currentStatus,
          nextStatus,
          mode: OPERATIONAL_MODE,
          error: result.error
        })
      }).catch(err => logger.error('Failed to log state machine audit', { error: err.message }));
    }

    if (OPERATIONAL_MODE === 'ENFORCE') {
      logger.error(errorMsg, { orderId });
      throw new Error(result.error);
    } else {
      logger.warn(`⚠️ [StateMachine Warning] ${errorMsg} (Allowed in LOG_ONLY mode)`, { orderId });
    }
  }

  return true;
};

module.exports = {
  checkTransition,
  validateTransition,
  ALLOWED_TRANSITIONS,
  OPERATIONAL_MODE
};
