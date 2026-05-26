const { z } = require('zod');

/**
 * 📝 Order Contracts (v1)
 * Enforces schema strictness across Domain Boundaries.
 */

// 1. Order Creation Contract
const CreateOrderSchema = z.object({
  branchId: z.string().min(1),
  items: z.array(z.any()).nullish(),
  cartItems: z.array(z.any()).nullish(),
  customerPhone: z.string().min(5).nullish(),
  phone: z.string().min(5).nullish(),
  customerName: z.string().nullish(),
  paymentMethod: z.string().nullish(),
  orderType: z.string().nullish(),
  deliveryType: z.string().nullish(),
  address: z.string().nullish(),
  addressId: z.string().nullish(),
  deliveryZoneId: z.union([z.string(), z.number()]).nullish(),
  notes: z.string().nullish()
}).passthrough();

// 2. Status Transition Contract (Command)
const TransitionStatusSchema = z.object({
  orderId: z.number().int(),
  status: z.string(),
  reason: z.string().optional(),
  idempotencyKey: z.string().min(8),
  version: z.number().int() // Optimistic locking version
}).strict();

// 3. Refund/Cancellation Request Contract
const CancellationRequestSchema = z.object({
  orderId: z.number().int(),
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
