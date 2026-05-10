const { z } = require('zod');

/**
 * 🛡️ Notification Payload Schema
 * Strict validation for all outgoing notifications.
 */
const notificationPayloadSchema = z.object({
  type: z.enum([
    'ORDER_STATUS_UPDATE',
    'ORDER_NEW',
    'PAYMENT_SUCCESS',
    'PROMOTION',
    'SYSTEM_ALERT'
  ]),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  deepLink: z.string().url().optional(),
  data: z.record(z.any()).optional(), // Custom metadata
  userId: z.number().optional(),
  topic: z.string().optional()
}).strict();

module.exports = {
  notificationPayloadSchema
};
