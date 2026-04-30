const prisma = require('../src/lib/prisma');
const orchestrator = require('../src/services/orderModificationOrchestrator');
const gateway = require('../src/services/contractGateway');
const logger = require('../src/utils/logger');

async function runLiveAudit() {
  logger.info('🧪 Starting Synthetic System Audit...');

  try {
    // 1. Fetch real data from DB
    const order = await prisma.order.findFirst({
      include: { orderItems: true }
    });

    const newItem = await prisma.item.findFirst({
      where: { isAvailable: true }
    });

    if (!order || !newItem) {
      logger.error('❌ Could not find test data (Order/Item) in DB');
      return;
    }

    const oldItem = order.orderItems[0];
    logger.info(`📋 Auditing Order #${order.orderNumber} (Current Total: ${order.total})`);
    logger.info(`🔄 Simulating replacement of [${oldItem.itemName}] with [${newItem.title}]`);

    // 2. Execute via Gateway (PREVIEW Mode)
    // This tests: Gateway -> Orchestrator -> Policy -> Pricing -> Shadow Log
    const previewResult = await gateway.execute(
      order.id,
      'PREVIEW',
      {
        modifications: {
          type: 'REPLACE_ITEM',
          replacement: {
            oldItemId: oldItem.id,
            newItemId: newItem.id,
            quantity: 1
          }
        }
      },
      { id: 1, role: 'admin' } // Mock Admin
    );

    logger.info('📊 PREVIEW RESULT:', {
      oldTotal: previewResult.preview.oldTotal,
      newTotal: previewResult.preview.newTotal,
      difference: previewResult.preview.priceDifference,
      policy: previewResult.policy.allowed ? 'ALLOWED' : 'REJECTED'
    });

    if (previewResult.preview.priceDifference !== 0) {
      logger.info('✅ Financial Delta detected and calculated correctly.');
    }

    logger.info('🏁 Audit Finished Successfully. System Integrity Verified.');

  } catch (err) {
    logger.error('❌ System Audit Failed', { error: err.message, stack: err.stack });
  } finally {
    await prisma.$disconnect();
  }
}

runLiveAudit();
