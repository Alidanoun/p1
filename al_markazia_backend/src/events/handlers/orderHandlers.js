const eventBus = require('../eventBus');
const eventTypes = require('../eventTypes');
const orderProjection = require('../../projections/orderProjection');
const analyticsProjection = require('../../projections/analyticsProjection');

/**
 * 📦 Order Lifecycle Handlers
 * Updates projections based on order events.
 */

// Handle New Orders
eventBus.subscribe(eventTypes.ORDER_CREATED, (event) => {
  orderProjection.upsertOrder(event.payload);
  analyticsProjection.handleCreated(event.payload);
});

// Handle Status Changes
eventBus.subscribe(eventTypes.ORDER_STATUS_CHANGED, (event) => {
  orderProjection.upsertOrder(event.payload.order);
  analyticsProjection.handleStatusChange(event.payload);
});

// Handle Cancellations
eventBus.subscribe(eventTypes.ORDER_CANCELLED, (event) => {
  orderProjection.upsertOrder(event.payload.order || event.payload);
  analyticsProjection.handleStatusChange({
    previousStatus: event.payload.previousStatus,
    newStatus: 'cancelled',
    order: event.payload.order || event.payload
  });
});

console.log('[EventHandlers] Order Projections Initialized');
