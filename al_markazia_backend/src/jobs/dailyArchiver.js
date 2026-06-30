const cron = require('node-cron');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const logger = require('../utils/logger');

const runDailyArchiver = async (targetBranchId = null) => {
  const lockKey = targetBranchId ? `lock:job:daily_archiver:${targetBranchId}` : 'lock:job:daily_archiver';
  let acquiredLock = false;

  try {
    const lockResult = await redis.set(lockKey, 'locked', 'NX', 'EX', 600).catch(err => {
      logger.warn('[DailyArchiver] Redis offline, running without lock protection', { error: err.message });
      return 'bypass';
    });

    if (lockResult !== 'locked' && lockResult !== 'bypass') {
      logger.info('[DailyArchiver] Job is already running in another instance. Skipping.');
      return;
    }

    if (lockResult === 'locked') {
      acquiredLock = true;
    }

    logger.info(`[DailyArchiver] Starting EOD archival process...${targetBranchId ? ` for branch ${targetBranchId}` : ''}`);

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    // Find all branches or target branch
    const branches = targetBranchId
      ? [{ id: targetBranchId }]
      : await prisma.branch.findMany({ select: { id: true } });

    for (const branch of branches) {
      // Find all completed or cancelled orders that are not archived yet for this branch
      const orders = await prisma.order.findMany({
        where: {
          branchId: branch.id,
          status: {
            in: ['delivered', 'cancelled']
          },
          isArchived: false
        }
      });

      if (orders.length > 0) {
        const deliveredOrders = orders.filter(o => o.status === 'delivered');
        const cancelledOrders = orders.filter(o => o.status === 'cancelled');
        
        let totalSales = 0;
        let taxTotal = 0;
        let totalPrepTime = 0;
        let validPrepCount = 0;

        for (const o of deliveredOrders) {
          totalSales += parseFloat(o.total || 0);
          taxTotal += parseFloat(o.tax || 0);
          if (o.preparationTimeMinutes) {
             totalPrepTime += o.preparationTimeMinutes;
             validPrepCount++;
          }
        }

        const avgPrepTime = validPrepCount > 0 ? Math.round(totalPrepTime / validPrepCount) : 0;

        // Upsert DailyReport
        await prisma.dailyReport.upsert({
          where: {
            date_branchId: {
              date: today,
              branchId: branch.id
            }
          },
          update: {
            totalSales,
            orderCount: deliveredOrders.length,
            cancelledCount: cancelledOrders.length,
            avgPrepTime,
            taxTotal
          },
          create: {
            date: today,
            branchId: branch.id,
            totalSales,
            orderCount: deliveredOrders.length,
            cancelledCount: cancelledOrders.length,
            avgPrepTime,
            taxTotal
          }
        });

        // Archive the orders so they don't show up in LiveOrders tomorrow (or whenever)
        const orderIds = orders.map(o => o.id);
        await prisma.order.updateMany({
          where: { id: { in: orderIds } },
          data: { isArchived: true }
        });

        logger.info(`[DailyArchiver] Branch ${branch.id}: Archived ${orders.length} orders.`);
      }
    }
    
    logger.info('[DailyArchiver] EOD archival process completed successfully.');
  } catch (error) {
    logger.error(`[DailyArchiver] Error during archival: ${error.message}`, { error });
  } finally {
    if (acquiredLock) {
      try {
        await redis.del(lockKey);
      } catch (delErr) {
        logger.warn('[DailyArchiver] Failed to release Redis lock', { error: delErr.message });
      }
    }
  }
};

// Schedule it to run at 23:59 every day
const startArchiverCron = () => {
  cron.schedule('59 23 * * *', async () => {
    await runDailyArchiver();
  });
  logger.info('[DailyArchiver] Cron job scheduled for 23:59 daily.');
};

module.exports = {
  runDailyArchiver,
  startArchiverCron
};
