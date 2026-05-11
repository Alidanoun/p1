const { z } = require('zod');

/**
 * 📝 Order Contracts (v1)
 * Enforces schema strictness across Domain Boundaries.
 */

// 1. Order Creation Contract
const CreateOrderSchema = z.object({
  branchId: z.string().uuid(),
  items: z.array(z.object({
    id: z.number(),
    quantity: z.number().int().positive(),
    optionIds: z.array(z.number()).optional()
  })).min(1),
  customerPhone: z.string().min(10),
  paymentMethod: z.enum(['cash', 'wallet', 'card']),
  deliveryType: z.enum(['pickup', 'delivery']),
  addressId: z.string().optional(),
  notes: z.string().optional()
}).strict();

// 2. Status Transition Contract (Command)
const TransitionStatusSchema = z.object({
  orderId: z.string().uuid(),
  targetStatus: z.string(),
  reason: z.string().optional(),
  idempotencyKey: z.string().min(8),
  version: z.number().int() // Optimistic locking version
}).strict();

// 3. Refund/Cancellation Request Contract
const CancellationRequestSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(5),
  managerPassword: z.string().optional(),
  idempotencyKey: z.string().min(8)
}).strict();

module.exports = {
  v1: {
    CreateOrderSchema,
    TransitionStatusSchema,
    CancellationRequestSchema
  }
};
