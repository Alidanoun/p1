const prisma = require('../lib/prisma');
const menuCacheService = require('./menuCacheService');
const logger = require('../utils/logger');

class BestsellerService {
  /**
   * 🔄 Calculates the most ordered items and updates `isFeatured` if Auto Mode is ON.
   * 🛡️ [FIX] Time Window: Only considers orders from the last N days (default 30).
   * 🚀 [PERF] Smart Update: Only updates items that actually changed status.
   */
  async updateBestsellers() {
    try {
      // 1. Check System Settings
      const settings = await prisma.systemSettings.findUnique({
        where: { key: 'system_config' }
      });
      let isAutoMode = false;
      let trendingWindowDays = 30; // Default to 30 days
      
      if (settings && settings.businessConfig) {
        const config = typeof settings.businessConfig === 'string' 
            ? JSON.parse(settings.businessConfig) 
            : settings.businessConfig;
        
        if (config.autoFeaturedMode === true) {
          isAutoMode = true;
        }
        if (config.trendingWindowDays) {
          trendingWindowDays = config.trendingWindowDays;
        }
      }

      if (!isAutoMode) {
        return { success: true, mode: 'manual', message: 'Auto Bestseller mode is disabled.' };
      }

      logger.info(`[BestsellerService] Auto Mode is ON. Calculating top items for the last ${trendingWindowDays} days...`);

      // 2. Find Top 5 Items by OrderItem quantity where Order is delivered AND recent
      const topItemsResult = await prisma.$queryRaw`
        SELECT "itemId", SUM("quantity") as "totalOrdered"
        FROM "OrderItem"
        INNER JOIN "Order" ON "Order"."id" = "OrderItem"."orderId"
        WHERE "OrderItem"."itemId" IS NOT NULL 
          AND "Order"."status" = 'delivered'
          AND "Order"."createdAt" >= NOW() - INTERVAL '${trendingWindowDays} days'
        GROUP BY "itemId"
        ORDER BY "totalOrdered" DESC
        LIMIT 5;
      `;

      const topItemIds = topItemsResult ? topItemsResult.map(row => Number(row.itemId)) : [];

      // 3. Smart Update: Compare current featured items with new top items
      const currentFeatured = await prisma.item.findMany({
        where: { isFeatured: true },
        select: { id: true }
      });
      const currentFeaturedIds = new Set(currentFeatured.map(i => i.id));
      const newTopIdsSet = new Set(topItemIds);

      const idsToRemove = [];
      const idsToAdd = [];

      // Identify items to remove (were featured, now not in top 5)
      for (const id of currentFeaturedIds) {
        if (!newTopIdsSet.has(id)) {
          idsToRemove.push(id);
        }
      }

      // Identify items to add (now in top 5, were not featured)
      for (const id of topItemIds) {
        if (!currentFeaturedIds.has(id)) {
          idsToAdd.push(id);
        }
      }

      // Only proceed if there are changes
      if (idsToRemove.length === 0 && idsToAdd.length === 0) {
        logger.info('[BestsellerService] No changes in bestsellers detected.');
        return { success: true, mode: 'auto', updated: 0 };
      }

      // Execute updates in a transaction
      await prisma.$transaction(async (tx) => {
        if (idsToRemove.length > 0) {
          await tx.item.updateMany({
            where: { id: { in: idsToRemove } },
            data: { isFeatured: false, version: { increment: 1 } }
          });
        }

        if (idsToAdd.length > 0) {
          await tx.item.updateMany({
            where: { id: { in: idsToAdd } },
            data: { isFeatured: true, version: { increment: 1 } }
          });
        }
      });

      // 4. Invalidate Menu Cache ONLY if changes occurred
      await menuCacheService.invalidate();

      logger.info(`[BestsellerService] Updated bestsellers. Removed: ${idsToRemove.length}, Added: ${idsToAdd.length}`);
      
      return { success: true, mode: 'auto', updatedItemIds: [...idsToAdd, ...idsToRemove] };

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
