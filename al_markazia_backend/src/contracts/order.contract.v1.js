const { z } = require('zod');

/**
 * 📝 Order Contracts (v1)
 * Enforces schema strictness across Domain Boundaries.
 */

// 1. Order Creation Contract
const CreateOrderSchema = z.object({
  branchId: z.string().min(1),
  items: z.array(z.any()).optional(),
  cartItems: z.array(z.any()).optional(),
  customerPhone: z.string().min(5).optional(),
  phone: z.string().min(5).optional(),
  customerName: z.string().optional(),
  paymentMethod: z.string().optional(),
  orderType: z.string().optional(),
  deliveryType: z.string().optional(),
  address: z.string().optional(),
  addressId: z.string().optional(),
  deliveryZoneId: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional()
}).passthrough();

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
