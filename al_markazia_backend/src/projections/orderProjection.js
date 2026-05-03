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

let activeBranchIds = new Set();

function getAllOrders(branchId) {
  const all = Array.from(orders.values());
  
  // 🛡️ Always filter out orders from deactivated branches for global view
  const activeOnly = all.filter(o => activeBranchIds.has(o.branchId));

  if (branchId) {
    return activeOnly.filter(o => o.branchId === branchId);
  }
  return activeOnly;
}

function getOrderById(id) {
  return orders.get(id.toString());
}

/**
 * 🔄 Startup Replay: Load active orders into memory
 */
async function replay() {
  const activeBranches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true }
  });
  activeBranchIds = new Set(activeBranches.map(b => b.id));

  const activeOrders = await prisma.order.findMany({
    where: { 
      status: { 
        notIn: ['cancelled', 'archived'] 
      },
      branchId: { in: Array.from(activeBranchIds) } // Only load orders from active branches
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
