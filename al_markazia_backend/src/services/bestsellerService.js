const prisma = require('../lib/prisma');
const menuCacheService = require('./menuCacheService');
const logger = require('../utils/logger');

class BestsellerService {
  /**
   * 🔄 Calculates the most ordered items and updates `isFeatured` if Auto Mode is ON.
   */
  async updateBestsellers() {
    try {
      // 1. Check System Settings
      const settings = await prisma.systemSettings.findUnique({
        where: { key: 'system_config' }
      });
      let isAutoMode = false;
      
      if (settings && settings.businessConfig) {
        const config = typeof settings.businessConfig === 'string' 
            ? JSON.parse(settings.businessConfig) 
            : settings.businessConfig;
        
        if (config.autoFeaturedMode === true) {
          isAutoMode = true;
        }
      }

      if (!isAutoMode) {
        // Auto mode disabled, do nothing (leave manual featured items as is)
        return { success: true, mode: 'manual', message: 'Auto Bestseller mode is disabled.' };
      }

      logger.info('[BestsellerService] Auto Mode is ON. Calculating top items...');

      // 2. Find Top 5 Items by OrderItem quantity where Order is delivered
      // Using Raw SQL for robust grouping and joining
      const topItemsResult = await prisma.$queryRaw`
        SELECT "itemId", SUM("quantity") as "totalOrdered"
        FROM "OrderItem"
        INNER JOIN "Order" ON "Order"."id" = "OrderItem"."orderId"
        WHERE "OrderItem"."itemId" IS NOT NULL 
          AND "Order"."status" = 'delivered'
        GROUP BY "itemId"
        ORDER BY "totalOrdered" DESC
        LIMIT 5;
      `;

      if (!topItemsResult || topItemsResult.length === 0) {
         logger.info('[BestsellerService] No delivered orders found to calculate bestsellers.');
         return { success: true, mode: 'auto', updated: 0 };
      }

      const topItemIds = topItemsResult.map(row => Number(row.itemId));

      // 3. Perform Transaction to update isFeatured flags
      await prisma.$transaction(async (tx) => {
        // Remove featured from all items
        await tx.item.updateMany({
          where: { isFeatured: true },
          data: { isFeatured: false, version: { increment: 1 } }
        });

        // Set featured for top items
        await tx.item.updateMany({
          where: { id: { in: topItemIds } },
          data: { isFeatured: true, version: { increment: 1 } }
        });
      });

      // 4. Invalidate Menu Cache
      await menuCacheService.invalidate();

      logger.info(`[BestsellerService] Successfully updated top ${topItemIds.length} bestsellers.`);
      
      return { success: true, mode: 'auto', updatedItemIds: topItemIds };

    } catch (error) {
      logger.error('[BestsellerService] Error updating bestsellers:', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Toggles the Auto Featured Mode setting
   */
  async toggleAutoMode(enabled) {
     let settings = await prisma.systemSettings.findUnique({
       where: { key: 'system_config' }
     });
     
     if (!settings) {
       settings = await prisma.systemSettings.create({
         data: { key: 'system_config', value: 'active', businessConfig: { autoFeaturedMode: enabled } }
       });
     } else {
       const config = typeof settings.businessConfig === 'string' 
           ? JSON.parse(settings.businessConfig) 
           : (settings.businessConfig || {});
       
       config.autoFeaturedMode = enabled;
       
       settings = await prisma.systemSettings.update({
         where: { id: settings.id },
         data: { businessConfig: config }
       });
     }

     logger.info(`[BestsellerService] Auto Featured Mode set to: ${enabled}`);
     
     // If turned on, immediately recalculate
     if (enabled) {
       await this.updateBestsellers();
     }

     return settings;
  }
}

module.exports = new BestsellerService();
