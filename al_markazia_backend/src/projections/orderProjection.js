const prisma = require('../lib/prisma');
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');

const orders = new Map();

function upsertOrder(order) {
  if (!order || !order.id) return;
  orders.set(order.id.toString(), order);
}

function removeOrder(orderId) {
  orders.delete(orderId.toString());
}

function getAllOrders() {
  return Array.from(orders.values());
}

function getOrderById(id) {
  return orders.get(id.toString());
}

/**
 * 🔄 Startup Replay: Load active orders into memory
 */
async function replay() {
  const activeOrders = await prisma.order.findMany({
    where: { 
      status: { 
        notIn: ['cancelled', 'archived'] 
      } 
    },
    include: ORDER_INCLUDE_FULL,
    orderBy: { createdAt: 'desc' }
  });

  orders.clear();
  activeOrders.forEach(o => upsertOrder(o));
}

module.exports = {
  upsertOrder,
  removeOrder,
  getAllOrders,
  getOrderById,
  replay
};
