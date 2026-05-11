const prisma = require('../lib/prisma');
const { deleteFile, formatImageUrl } = require('../utils/fileUploadHelper');
const logger = require('../utils/logger');
const itemFilters = require('../utils/itemFilters');
const { toNumber } = require('../utils/number');
const { safeJsonParse } = require('../utils/security');
const menuCacheService = require('../services/menuCacheService');
const imageService = require('../services/imageService');

exports.getAllItems = async (req, res) => {
  try {
    const { admin, categoryId, featured } = req.query;

    // ⚡ [PHASE 2] ETag Check for Performance (304 Not Modified)
    if (admin !== 'true' && !categoryId && !featured) {
      const currentETag = await menuCacheService.getETag();
      if (currentETag && req.headers['if-none-match'] === currentETag) {
        return res.status(304).end();
      }

      // Check Redis Snapshot
      const cachedMenu = await menuCacheService.getMenu();
      if (cachedMenu) {
        res.setHeader('ETag', currentETag);
        return res.json({ success: true, data: JSON.parse(cachedMenu), cached: true });
      }
    }

    let filter = {};
    if (admin === 'true') {
      filter = itemFilters.getAdminPanelFilter();
    } else if (featured === 'true') {
      filter = itemFilters.getFeaturedSectionFilter();
    } else {
      filter = itemFilters.getPublicMenuFilter();
    }

    if (categoryId) filter.categoryId = parseInt(categoryId);

    let targetBranchId = req.query.branchId || req.user?.branchId || null;
    if (targetBranchId === 'null' || targetBranchId === 'undefined') targetBranchId = null;

    // 🛠️ [FIX] Proper conditional include for Prisma
    const includeOptions = {
      category: { select: { id: true, name: true, nameEn: true } },
      variants: { where: { isAvailable: true } },
      modifierGroups: {
        where: { isActive: true },
        include: {
          modifiers: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
        },
        orderBy: { sortOrder: 'asc' }
      }
    };

    if (targetBranchId) {
      includeOptions.branchItems = {
        where: { branchId: targetBranchId },
        select: { isAvailable: true, branchId: true }
      };
      
      // 🛡️ [SEC-FIX] In branch mode, ONLY show items that are actually linked to this branch
      filter.branchItems = {
        some: { branchId: targetBranchId }
      };
    }

    const items = await prisma.item.findMany({
      where: filter,
      include: includeOptions,
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    const mappedItems = items.map(item => {
      let finalAvailability = item.isAvailable;
      if (item.branchItems && item.branchItems.length > 0) {
        finalAvailability = item.branchItems[0].isAvailable;
      }

      return {
        ...item,
        isAvailable: finalAvailability,
        image: formatImageUrl(item.image),
        basePrice: toNumber(item.basePrice),
        branchItems: undefined
      };
    });

    // ⚡ [PHASE 2] Warmup Cache for next requests if this is the full public menu
    if (admin !== 'true' && !categoryId && !featured) {
      await menuCacheService.setMenu(mappedItems);
      const etag = await menuCacheService.getETag();
      if (etag) res.setHeader('ETag', etag);
    }

    res.json({ success: true, data: mappedItems });
  } catch (error) {
    logger.error('Failed to fetch items', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
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
        variants: { where: { isAvailable: true } },
        modifierGroups: {
          where: { isActive: true },
          include: {
            modifiers: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
          },
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({
      ...item,
      image: formatImageUrl(item.image)
    });
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
      preparationTime,
      variants,
      modifierGroups
    } = req.body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ success: false, error: 'العنوان مطلوب ولا يمكن أن يكون فارغاً' });
    }

    const parsedPrice = toNumber(basePrice, -1);
    if (parsedPrice < 0) {
      return res.status(400).json({ success: false, error: 'السعر يجب أن يكون رقماً صالحاً وغير سالب' });
    }

    let imageUrl = null;
    if (req.file) {
      const processed = await imageService.processMenuImage(req.file.filename);
      imageUrl = processed ? processed.medium : `/uploads/${req.file.filename}`;
    }

    let parsedGroups = [];
    if (modifierGroups) {
      parsedGroups = typeof modifierGroups === 'string' ? safeJsonParse(modifierGroups) : modifierGroups;
    }

    let parsedVariants = [];
    if (variants) {
      parsedVariants = typeof variants === 'string' ? safeJsonParse(variants) : variants;
    }

    // 🛡️ [SEC-FIX] Pre-validate option prices before transaction
    if (parsedGroups.length > 0) {
      for (const group of parsedGroups) {
        for (const opt of group.options) {
          const optPrice = parseFloat(opt.price);
          if (isNaN(optPrice) || optPrice < 0) {
            return res.status(400).json({ error: `سعر الإضافة "${opt.name}" غير صحيح، يرجى إدخال رقم موجب` });
          }
        }
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      const newItem = await tx.item.create({
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
          image: imageUrl,
          variants: {
            create: parsedVariants.map(v => ({
              name: v.name,
              nameEn: v.nameEn,
              priceDiff: parseFloat(v.priceDiff) || 0,
              isDefault: v.isDefault || false
            }))
          },
          modifierGroups: {
            create: parsedGroups.map(group => ({
              groupName: group.groupName,
              groupNameEn: group.groupNameEn,
              type: group.type || 'SINGLE',
              isRequired: group.isRequired || false,
              minSelection: parseInt(group.minSelection) || 0,
              maxSelection: parseInt(group.maxSelection) || 1,
              modifiers: {
                create: group.modifiers.map(mod => ({
                  name: mod.name,
                  nameEn: mod.nameEn,
                  price: parseFloat(mod.price) || 0,
                  isDefault: mod.isDefault || false,
                  isAvailable: mod.isAvailable !== false
                }))
              }
            }))
          }
        },
        include: {
          category: { select: { id: true, name: true, nameEn: true } },
          variants: true,
          modifierGroups: { include: { modifiers: true } }
        }
      });

      // 🏢 [AUTO-LINK] Automatically make this item available in all branches
      const branches = await tx.branch.findMany({ select: { id: true } });
      if (branches.length > 0) {
        await tx.branchItem.createMany({
          data: branches.map(b => ({
            branchId: b.id,
            itemId: newItem.id,
            isAvailable: true
          }))
        });
        logger.info(`[AutoLink] Linked new item ${newItem.id} to ${branches.length} branches`);
      }

      return newItem;
    });

    await menuCacheService.invalidate();

    res.status(201).json({
      success: true,
      data: item
    });
  } catch (error) {
    logger.error('Create item error', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل في إنشاء الصنف' });
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
    if (!currentItem) return res.status(404).json({ success: false, error: 'Item not found' });

    let imageUrl = currentItem.image;

    if (req.file) {
      if (currentItem.image) await deleteFile(currentItem.image);
      const processed = await imageService.processMenuImage(req.file.filename);
      imageUrl = processed ? processed.medium : `/uploads/${req.file.filename}`;
    } else if (removeImage === 'true') {
      if (currentItem.image) await deleteFile(currentItem.image);
      imageUrl = null;
    }

    let parsedGroups = [];
    if (req.body.optionGroups) {
      parsedGroups = typeof req.body.optionGroups === 'string' ? safeJsonParse(req.body.optionGroups) : req.body.optionGroups;

      // 🛡️ [SEC-FIX] Pre-validate option prices
      for (const group of parsedGroups) {
        for (const opt of group.options) {
          const optPrice = parseFloat(opt.price);
          if (isNaN(optPrice) || optPrice < 0) {
            return res.status(400).json({ error: `سعر الإضافة "${opt.name}" غير صحيح، يرجى إدخال رقم موجب` });
          }
        }
      }
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
        image: imageUrl,
        variants: req.body.variants ? {
          deleteMany: {},
          create: parsedVariants.map(v => ({
            name: v.name,
            nameEn: v.nameEn,
            priceDiff: parseFloat(v.priceDiff) || 0,
            isDefault: v.isDefault || false
          }))
        } : undefined,
        modifierGroups: req.body.modifierGroups ? {
          deleteMany: {},
          create: parsedGroups.map(group => ({
            groupName: group.groupName,
            groupNameEn: group.groupNameEn,
            type: group.type || 'SINGLE',
            isRequired: group.isRequired || false,
            minSelection: parseInt(group.minSelection) || 0,
            maxSelection: parseInt(group.maxSelection) || 1,
            modifiers: {
              create: group.modifiers.map(mod => ({
                name: mod.name,
                nameEn: mod.nameEn,
                price: parseFloat(mod.price) || 0,
                isDefault: mod.isDefault || false,
                isAvailable: mod.isAvailable !== false
              }))
            }
          }))
        } : undefined
      },
      include: {
        category: { select: { id: true, name: true, nameEn: true } },
        variants: true,
        modifierGroups: { include: { modifiers: true } }
      }
    });

    await menuCacheService.invalidate();

    res.json({
      success: true,
      data: updatedItem
    });
  } catch (error) {
    logger.error('Update item error', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'فشل في تحديث الصنف' });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (item.image) await deleteFile(item.image);

    await prisma.item.delete({ where: { id: parseInt(id) } });
    await menuCacheService.invalidate();
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete item' });
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

    await menuCacheService.invalidate();
    res.json({ success: true, data: updatedItem });
  } catch (error) {
    res.status(500).json({ success: false, error: 'فشل في تحديث حالة الصنف.' });
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

    await menuCacheService.invalidate();
    res.json({ success: true, data: updatedGroup.item });
  } catch (error) {
    res.status(500).json({ success: false, error: 'فشل في تحديث حالة المجموعة.' });
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

    await menuCacheService.invalidate();
    res.json({ success: true, data: updatedOption.group.item });
  } catch (error) {
    logger.error('[ToggleOptionError]', { error: error.message, body: req.body });
    res.status(500).json({ success: false, error: 'فشل في تحديث حالة الإضافة.' });
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
    res.json({ success: true, message: 'Featured items updated successfully' });
  } catch (error) {
    logger.error('[UpdateFeaturedItems Error]', { error: error.message, body: req.body });
    res.status(500).json({ success: false, error: 'فشل في تحديث الأصناف الأكثر طلباً' });
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
    res.json({ success: true, data: updatedItem });
  } catch (error) {
    logger.error('[ToggleExclusionError]', { error: error.message, itemId: req.params.id });
    res.status(500).json({ success: false, error: 'فشل في تعديل حالة استبعاد الصنف.' });
  }
};
