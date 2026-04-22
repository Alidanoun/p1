const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');

/**
 * Delivery Zone Service - Production Grade
 * Handles business logic for delivery areas & pricing
 */
class DeliveryZoneService {
  /**
   * Get all zones for administration
   */
  async getAllZones() {
    return await prisma.deliveryZone.findMany({
      orderBy: { sortOrder: 'asc' }
    });
  }

  /**
   * Get active zones for customers
   */
  async getActiveZones() {
    return await prisma.deliveryZone.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });
  }

  /**
   * Create a new zone with validation
   */
  async createZone(data, adminId) {
    const nameAr = data.nameAr?.trim();
    if (!nameAr) throw new Error('اسم المنطقة مطلوب');

    // Case-insensitive uniqueness check
    const existing = await prisma.deliveryZone.findFirst({
      where: { nameAr: { equals: nameAr, mode: 'insensitive' } }
    });

    if (existing) throw new Error('اسم المنطقة موجود مسبقاً');

    const zone = await prisma.deliveryZone.create({
      data: {
        ...data,
        nameAr,
        fee: toNumber(data.fee),
        minOrder: data.minOrder ? toNumber(data.minOrder) : null,
      }
    });

    logger.info('Delivery zone created', { zoneId: zone.id, adminId });
    return zone;
  }

  /**
   * Update zone details
   */
  async updateZone(id, data, adminId) {
    const existing = await prisma.deliveryZone.findUnique({ where: { id } });
    if (!existing) throw new Error('المنطقة غير موجودة');

    // If name changes, check for duplicates
    if (data.nameAr && data.nameAr.trim().toLowerCase() !== existing.nameAr.toLowerCase()) {
      const duplicate = await prisma.deliveryZone.findFirst({
        where: { 
          nameAr: { equals: data.nameAr.trim(), mode: 'insensitive' },
          id: { not: id }
        }
      });
      if (duplicate) throw new Error('اسم المنطقة موجود مسبقاً');
    }

    const updated = await prisma.deliveryZone.update({
      where: { id },
      data: {
        ...data,
        fee: data.fee !== undefined ? toNumber(data.fee) : undefined,
        minOrder: data.minOrder !== undefined ? (data.minOrder ? toNumber(data.minOrder) : null) : undefined,
      }
    });

    logger.info('Delivery zone updated', { zoneId: id, adminId, changes: Object.keys(data) });
    return updated;
  }

  /**
   * Delete zone (Safety: Consider checking for impact or deactivating instead)
   */
  async deleteZone(id, adminId) {
    // Note: We don't have a direct relation between Order and DeliveryZone ID in schema (just fee/address)
    // but if we did, we'd check for dependencies here.
    await prisma.deliveryZone.delete({ where: { id } });
    logger.info('Delivery zone deleted', { zoneId: id, adminId });
    return { success: true };
  }
}

module.exports = new DeliveryZoneService();
