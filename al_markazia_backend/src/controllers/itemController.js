const prisma = require('../lib/prisma');
const { deleteFile } = require('../utils/fileUploadHelper');
const logger = require('../utils/logger');
const itemFilters = require('../utils/itemFilters');
const { toNumber } = require('../utils/number');

exports.getAllItems = async (req, res) => {
  try {
    const { admin, categoryId, featured } = req.query;

    let filter = {};
    
    // 🛡️ Applying Tiered Visibility Model (Architectural Standard V19)
    if (admin === 'true') {
      filter = itemFilters.getAdminPanelFilter();
    } else if (featured === 'true') {
      filter = itemFilters.getFeaturedSectionFilter();
    } else {
      filter = itemFilters.getPublicMenuFilter();
    }

    if (categoryId) filter.categoryId = parseInt(categoryId);

    const items = await prisma.item.findMany({
      where: filter,
      select: {
        id: true,
        title: true,
        titleEn: true,
        description: true,
        descriptionEn: true,
        basePrice: true,
        image: true,
        categoryId: true,
        isAvailable: true,
        isFeatured: true,
        preparationTime: true,
        cachedAvgRating: true,
        cachedReviewCount: true,
        category: {
          select: { id: true, name: true, nameEn: true }
        },
        optionGroups: {
          where: { isActive: true },
          include: {
            options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
          },
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json(items);
  } catch (error) {
    logger.error('Failed to fetch items', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch items' });
  }
};

/**
 * 🔍 Professional Search Optimization (V22)
 * Searches in title and description across multiple languages.
 * Includes query sanitization, normalization, and analytics logging.
 */
exports.searchItems = async (req, res) => {
  const startTime = Date.now();
  try {
    const { q } = req.query;

    // 1️⃣ Normalize & Sanitize (Security Hardening)
    if (!q || q.trim().length < 2) {
      return res.json([]);
    }

    const sanitizedQuery = q.trim().replace(/[%_]/g, '');
    const normalizedQuery = sanitizedQuery.toLowerCase();

    // 2️⃣ Atomic DB Operation with Smart Ranking
    const items = await prisma.item.findMany({
      where: {
        AND: [
          { isAvailable: true },
          {
            OR: [
              { title: { contains: normalizedQuery, mode: 'insensitive' } },
              { titleEn: { contains: normalizedQuery, mode: 'insensitive' } },
              { description: { contains: normalizedQuery, mode: 'insensitive' } },
              { descriptionEn: { contains: normalizedQuery, mode: 'insensitive' } },
            ]
          }
        ]
      },
      take: 20,
      include: {
        category: true
      }
    });

    const durationMs = Date.now() - startTime;

    // 3️⃣ Analytics-Ready Logging
    logger.info('search_performance', {
      query: sanitizedQuery,
      resultCount: items.length,
      durationMs,
      userId: req.user?.id || 'guest'
    });

    res.json(items);
  } catch (error) {
    logger.error('Search operation failed', { 
      error: error.message, 
      query: req.query.q 
    });
    res.status(500).json({ error: 'Failed to perform search' });
  }
};

exports.getItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.item.findUnique({
      where: { id: parseInt(id) },
      include: {
        category: true,
        optionGroups: {
          where: { isActive: true },
          include: {
            options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
          },
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch item' });
  }
};

exports.createItem = async (req, res) => {
  try {
    const {
      title,
      titleEn,
      description,
      descriptionEn,
      basePrice,
      categoryId,
      isAvailable,
      isFeatured,
      excludeFromStats,
      preparationTime
    } = req.body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'العنوان مطلوب ولا يمكن أن يكون فارغاً' });
    }

    const parsedPrice = toNumber(basePrice, -1);
    if (parsedPrice < 0) {
      return res.status(400).json({ error: 'السعر يجب أن يكون رقماً صالحاً وغير سالب' });
    }

    const item = await prisma.item.create({
      data: {
        title,
        titleEn,
        description,
        descriptionEn,
        basePrice: parsedPrice,
        categoryId: parseInt(categoryId),
        isAvailable: isAvailable === 'true' || isAvailable === true,
        isFeatured: isFeatured === 'true' || isFeatured === true,
        excludeFromStats: excludeFromStats === 'true' || excludeFromStats === true,
        preparationTime: preparationTime ? parseInt(preparationTime) : null,
        image: req.file ? `/uploads/items/${req.file.filename}` : null
      }
    });

    res.status(201).json(item);
  } catch (error) {
    logger.error('Item creation failed', { error: error.message });
    res.status(500).json({ error: 'فشل إنشاء الصنف' });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      titleEn,
      description,
      descriptionEn,
      basePrice,
      categoryId,
      isAvailable,
      isFeatured,
      excludeFromStats,
      preparationTime,
      removeImage
    } = req.body;

    const currentItem = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    if (!currentItem) return res.status(404).json({ error: 'Item not found' });

    let imageUrl = currentItem.image;

    if (req.file) {
      if (currentItem.image) await deleteFile(currentItem.image);
      imageUrl = `/uploads/items/${req.file.filename}`;
    } else if (removeImage === 'true') {
      if (currentItem.image) await deleteFile(currentItem.image);
      imageUrl = null;
    }

    const parsedPrice = toNumber(basePrice, -1);

    const updatedItem = await prisma.item.update({
      where: { id: parseInt(id) },
      data: {
        title,
        titleEn,
        description,
        descriptionEn,
        basePrice: parsedPrice >= 0 ? parsedPrice : undefined,
        categoryId: categoryId ? parseInt(categoryId) : undefined,
        isAvailable: isAvailable === 'true' || isAvailable === true,
        isFeatured: isFeatured === 'true' || isFeatured === true,
        excludeFromStats: excludeFromStats === 'true' || excludeFromStats === true,
        preparationTime: preparationTime ? parseInt(preparationTime) : null,
        image: imageUrl
      }
    });

    res.json(updatedItem);
  } catch (error) {
    logger.error('Item update failed', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'فشل تحديث الصنف' });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (item.image) await deleteFile(item.image);

    await prisma.item.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
};

exports.toggleItemAvailable = async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const updatedItem = await prisma.item.update({
      where: { id: parseInt(id) },
      data: { isAvailable: isAvailable === true }
    });

    res.json(updatedItem);
  } catch (error) {
    res.status(500).json({ error: 'فشل في تحديث حالة الصنف.' });
  }
};

exports.toggleGroupActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const updatedGroup = await prisma.itemOptionGroup.update({
      where: { id: parseInt(id) },
      data: { isActive: isActive === true },
      include: {
        item: {
          include: {
            category: true,
            optionGroups: {
              where: { isActive: true },
              include: {
                options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
              },
              orderBy: { sortOrder: 'asc' }
            }
          }
        }
      }
    });

    res.json(updatedGroup.item);
  } catch (error) {
    res.status(500).json({ error: 'فشل في تحديث حالة المجموعة.' });
  }
};

exports.toggleOptionAvailable = async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const updatedOption = await prisma.itemOption.update({
      where: { id: parseInt(id) },
      data: { isAvailable: isAvailable === true },
      include: {
        group: {
          include: {
            item: {
              include: {
                category: true,
                optionGroups: {
                  where: { isActive: true },
                  include: {
                    options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
                  },
                  orderBy: { sortOrder: 'asc' }
                }
              }
            }
          }
        }
      }
    });

    res.json(updatedOption.group.item);
  } catch (error) {
    logger.error('[ToggleOptionError]', { error: error.message, body: req.body });
    res.status(500).json({ error: 'فشل في تحديث حالة الإضافة.' });
  }
};

exports.updateFeaturedItems = async (req, res) => {
  try {
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds)) {
      return res.status(400).json({ error: 'itemIds should be an array' });
    }

    await prisma.$transaction([
      prisma.item.updateMany({
        data: { isFeatured: false },
      }),
      prisma.item.updateMany({
        where: { id: { in: itemIds.map(id => parseInt(id)) } },
        data: { isFeatured: true },
      }),
    ]);

    logger.info('Featured items updated', { count: itemIds.length, itemIds });
    res.json({ message: 'Featured items updated successfully' });
  } catch (error) {
    logger.error('[UpdateFeaturedItems Error]', { error: error.message, body: req.body });
    res.status(500).json({ error: 'فشل في تحديث الأصناف الأكثر طلباً' });
  }
};

exports.toggleExclusion = async (req, res) => {
  try {
    const { id } = req.params;
    const { exclude } = req.body;

    const updatedItem = await prisma.item.update({
      where: { id: parseInt(id) },
      data: { excludeFromStats: exclude === true }
    });

    logger.info('Item exclusion toggled', { itemId: id, exclude: updatedItem.excludeFromStats });
    res.json(updatedItem);
  } catch (error) {
    logger.error('[ToggleExclusionError]', { error: error.message, itemId: req.params.id });
    res.status(500).json({ error: 'فشل في تعديل حالة استبعاد الصنف.' });
  }
};
