const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

const runDailyArchiver = async () => {
  logger.info('[DailyArchiver] Starting EOD archival process...');
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    // Find all branches
    const branches = await prisma.branch.findMany({ select: { id: true } });

    for (const branch of branches) {
      // Find completed or cancelled orders for today for this branch
      const orders = await prisma.order.findMany({
        where: {
          branchId: branch.id,
          createdAt: {
            gte: today
          },
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
          totalSales += parseFloat(o.totalPrice || 0);
          taxTotal += parseFloat(o.taxAmount || 0);
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
