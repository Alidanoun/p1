const prisma = require('../src/lib/prisma');
const menuCacheService = require('../src/services/menuCacheService');
const logger = require('../src/utils/logger');
const { formatImageUrl } = require('../src/utils/fileUploadHelper');
const { toNumber } = require('../src/utils/number');

/**
 * 🌡️ Menu Cache Warmup Script
 * Builds the initial menu snapshot in Redis to prevent cold starts.
 */
async function warmup() {
  console.log('🌡️ Starting Menu Cache Warmup...');
  
  try {
    const items = await prisma.item.findMany({
      where: { isDeleted: false, isAvailable: true },
      include: {
        category: { select: { id: true, name: true, nameEn: true } },
        variants: { where: { isAvailable: true } },
        modifierGroups: {
          where: { isActive: true },
          include: {
            modifiers: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
          },
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    const mappedItems = items.map(item => ({
      ...item,
      image: formatImageUrl(item.image),
      basePrice: toNumber(item.basePrice)
    }));

    const etag = await menuCacheService.setMenu(mappedItems);
    console.log(`✅ Menu Cache Warmed Up! ETag: ${etag}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Warmup Failed:', err.message);
    process.exit(1);
  }
}

warmup();
