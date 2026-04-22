/**
 * 🗺️ Order Mapper — Data Contract Layer
 * THE one and only place where Prisma Order → API Response transformation happens.
 * No Decimal leaks. No field name confusion. Production-grade.
 */

const { toNumber, toMoney } = require('../utils/number');

/**
 * Maps a raw Prisma Order (with Decimal fields) to a safe API response.
 * This function is the SINGLE exit point for all order data leaving the backend.
 *
 * @param {Object} order - Raw Prisma order (with includes)
 * @returns {Object} Safe, frontend-ready order object
 */
const mapOrderResponse = (order) => {
  if (!order) return null;

  const subtotal    = toMoney(order.subtotal);
  const discount    = toMoney(order.discount);
  const tax         = toMoney(order.tax);
  const deliveryFee = toMoney(order.deliveryFee);
  const total       = toMoney(order.total);

  return {
    // --- Identity ---
    id:           order.id.toString(),
    orderNumber:  order.orderNumber,

    // --- Customer ---
    customerName:  order.customerName,
    customerPhone: order.customerPhone,
    customerId:    order.customerId,

    // --- Status & Type ---
    status:        order.status,
    orderType:     order.orderType,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,

    // --- Financials (ALL guaranteed Number, never Decimal) ---
    subtotal,
    discount,
    tax,
    deliveryFee,
    total,
    totalPrice: total, // Backward compat alias

    // --- Delivery Snapshot ---
    deliveryZoneId:   order.deliveryZoneId,
    deliveryZoneName: order.deliveryZoneName,
    deliveryMinOrder: toMoney(order.deliveryMinOrder),

    // --- Meta ---
    address:          order.address,
    notes:            order.notes,
    branch:           order.branch,
    estimatedReadyAt: order.estimatedReadyAt,
    rating:           order.rating,
    ratingComment:    order.ratingComment,
    version:          order.version,
    createdAt:        order.createdAt,
    updatedAt:        order.updatedAt,

    // --- Relations (safe-mapped) ---
    cartItems: mapOrderItems(order.orderItems),
    cancellation: order.cancellation || null,
    customer: order.customer ? {
      id:    order.customer.id,
      uuid:  order.customer.uuid,
      name:  order.customer.name,
      phone: order.customer.phone,
    } : null,
  };
};

/**
 * Maps raw Prisma OrderItems to safe API response items.
 * Converts all Decimal fields to Numbers.
 */
const mapOrderItems = (items) => {
  if (!items || !Array.isArray(items)) return [];

  return items.map(item => ({
    id:              item.id.toString(),
    itemId:          item.itemId,
    itemName:        item.itemName,
    itemNameEn:      item.itemNameEn,
    quantity:        item.quantity,
    unitPrice:       toMoney(item.unitPrice),
    lineTotal:       toMoney(item.lineTotal),
    selectedOptions:   item.selectedOptions,
    selectedOptionsEn: item.selectedOptionsEn,
    notes:           item.notes,
    status:          item.status,
    rejectionReason: item.rejectionReason,

    // Backward compat aliases (used by LiveOrders.jsx)
    qty:   item.quantity,
    title: item.itemName,
    price: toMoney(item.unitPrice),
  }));
};

module.exports = { mapOrderResponse, mapOrderItems };
