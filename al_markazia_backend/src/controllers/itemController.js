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
      include: {
        category: true,
        optionGroups: {
          include: {
            options: true
          },
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 🛡️ Architectural V19: Independent data delivery.
    // We return raw flags to allow the UI to handle visibility independently of analytics.
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
    // Remove characters that might interfere with SQL LIKE patterns if not handled by Prisma automatically
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
      },
      // Smart Sorting: Sort by Title Ascending then by newest first
      orderBy: [
        { title: 'asc' },
        { createdAt: 'desc' }
      ]
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

    const parsedCategoryId = parseInt(categoryId);
    if (isNaN(parsedCategoryId) || parsedCategoryId <= 0) {
      return res.status(400).json({ error: 'الفئة غير صالحة' });
    }

    const imageUrl = req.file ? req.file.path : null;

    const optionGroups = req.body.optionGroups ? JSON.parse(req.body.optionGroups) : [];

    const newItem = await prisma.item.create({
      data: {
        title: title.trim(),
        titleEn: titleEn ? titleEn.trim() : null,
        description: description ? description.trim() : '',
        descriptionEn: descriptionEn ? descriptionEn.trim() : null,
        basePrice: parsedPrice,
        categoryId: parsedCategoryId,
        isAvailable: isAvailable === 'false' || isAvailable === false ? false : true,
        isFeatured: isFeatured === 'true' || isFeatured === true,
        excludeFromStats: excludeFromStats === 'true' || excludeFromStats === true,
        preparationTime: parseInt(preparationTime) || null,
        image: imageUrl,
        optionGroups: {
          create: optionGroups.map((group, gIdx) => ({
            groupName: group.groupName || 'مجموعة خيارات',
            groupNameEn: group.groupNameEn || null,
            type: group.type || 'SINGLE',
            isRequired: group.isRequired === true || group.isRequired === 'true',
            isActive: group.isActive !== false && group.isActive !== 'false',
            minSelect: parseInt(group.minSelect) || 0,
            maxSelect: parseInt(group.maxSelect) || 1,
            sortOrder: gIdx,
            options: {
              create: (group.options || []).map((opt, oIdx) => ({
                name: opt.name || 'خيار',
                nameEn: opt.nameEn || null,
                price: toNumber(opt.price),
                isDefault: opt.isDefault === true || opt.isDefault === 'true',
                isAvailable: opt.isAvailable !== false && opt.isAvailable !== 'false',
                sortOrder: oIdx
              }))
            }
          }))
        }
      },
      include: {
        optionGroups: {
          include: { options: true }
        }
      }
    });

    logger.info('Item created', { 
      name: newItem.title, 
      category: newItem.categoryId, 
      price: newItem.basePrice,
      itemId: newItem.id
    });
    res.status(201).json(newItem);
  } catch (error) {
    logger.error('Create item error', { error: error.message, body: req.body });
    res.status(500).json({ error: 'فشل في إضافة الصنف. تأكد من صحة البيانات المرسلة.' });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, titleEn, description, descriptionEn, basePrice, categoryId, isAvailable, isFeatured, excludeFromStats, preparationTime } = req.body;

    const updateData = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim() === '') return res.status(400).json({ error: 'العنوان لا يمكن أن يكون فارغاً' });
      updateData.title = title.trim();
    }
    if (description !== undefined) updateData.description = description;
    if (titleEn !== undefined) updateData.titleEn = titleEn ? titleEn.trim() : null;
    if (descriptionEn !== undefined) updateData.descriptionEn = descriptionEn ? descriptionEn.trim() : null;
    
    if (basePrice !== undefined) {
      const parsedPrice = toNumber(basePrice, -1);
      if (parsedPrice < 0) return res.status(400).json({ error: 'السعر يجب أن يكون غير سالب' });
      updateData.basePrice = parsedPrice;
    }

    if (categoryId !== undefined) {
      const parsedCategoryId = parseInt(categoryId);
      if (isNaN(parsedCategoryId) || parsedCategoryId <= 0) return res.status(400).json({ error: 'الفئة غير صالحة' });
      updateData.categoryId = parsedCategoryId;
    }

    if (isFeatured !== undefined) {
      updateData.isFeatured = isFeatured === 'true' || isFeatured === true;
    }

    if (excludeFromStats !== undefined) {
      updateData.excludeFromStats = excludeFromStats === 'true' || excludeFromStats === true;
    }

    if (preparationTime !== undefined) {
      updateData.preparationTime = parseInt(preparationTime) || null;
    }

    // Robust isAvailable check for both Boolean and Form-data String
    if (isAvailable !== undefined) {
      updateData.isAvailable = isAvailable === 'true' || isAvailable === true;
    }

    if (req.file) {
      try {
        // Delete old image first to avoid orphans
        const existingItem = await prisma.item.findUnique({
          where: { id: parseInt(id) },
          select: { image: true }
        });

        if (existingItem?.image) {
          deleteFile(existingItem.image);
        }
      } catch (err) {
        logger.error('[UpdateItem] Pre-update cleanup error', { error: err.message, itemId: id });
      }

      updateData.image = req.file.path;
    }

    let optionGroups = req.body.optionGroups;
    if (optionGroups && typeof optionGroups === 'string') {
      try {
        optionGroups = JSON.parse(optionGroups);
      } catch (e) {
        logger.warn('[UpdateItem] Failed to parse optionGroups JSON', { error: e.message, itemId: id });
        return res.status(400).json({ error: 'تنسيق الخيارات غير صحيح' });
      }
    }

    const updatedItem = await prisma.item.update({
      where: { id: parseInt(id) },
      data: {
        ...updateData,
        optionGroups: (optionGroups && Array.isArray(optionGroups)) ? {
          deleteMany: {}, // Atomically clear then rebuild to avoid ID conflicts
          create: optionGroups.map((group, gIdx) => ({
            groupName: group.groupName || 'مجموعة خيارات',
            groupNameEn: group.groupNameEn || null,
            type: group.type || 'SINGLE',
            isRequired: group.isRequired === true || group.isRequired === 'true',
            isActive: group.isActive !== false && group.isActive !== 'false',
            minSelect: parseInt(group.minSelect) || 0,
            maxSelect: parseInt(group.maxSelect) || 1,
            sortOrder: gIdx,
            options: {
              create: (group.options || []).map((opt, oIdx) => ({
                name: opt.name || 'خيار',
                nameEn: opt.nameEn || null,
                price: toNumber(opt.price),
                isDefault: opt.isDefault === true || opt.isDefault === 'true',
                isAvailable: opt.isAvailable !== false && opt.isAvailable !== 'false',
                sortOrder: oIdx
              }))
            }
          }))
        } : undefined
      },
      include: {
        optionGroups: {
          include: { options: true }
        }
      }
    });

    logger.info('Item updated', { 
      itemId: id, 
      changedFields: Object.keys(updateData) 
    });
    res.json(updatedItem);

  } catch (error) {
    logger.error('UpdateItem Error', { error: error.message, itemId: req.params.id });
    res.status(500).json({
      error: 'فشل في تحديث الصنف. تأكد من صحة البيانات.',
      details: error.message
    });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Fetch item to get the image path before deleting the record
    const item = await prisma.item.findUnique({
      where: { id: parseInt(id) }
    });

    if (!item) {
      logger.warn('Attempt to delete item that does not exist', { itemId: id });
      return res.status(404).json({ error: 'الصنف غير موجود' });
    }

    // 2. Delete the record from DB
    await prisma.item.delete({ where: { id: parseInt(id) } });

    // 3. Delete the image file if it exists
    if (item.image) {
      deleteFile(item.image);
    }

    logger.info('Item deleted', { itemId: id, name: item.title });
    res.json({ message: 'Item deleted successfully and image cleaned up' });
  } catch (error) {
    logger.error('Delete item error', { error: error.message, itemId: req.params.id });
    res.status(500).json({ error: 'Failed to delete item' });
  }
};

exports.toggleOptionAvailability = async (req, res) => {
  try {
    const { optionId, isAvailable } = req.body;

    if (optionId === undefined || isAvailable === undefined) {
      return res.status(400).json({ error: 'optionId و isAvailable مطلوبان' });
    }

    // Single query: update the option AND get its full parent item in one go
    const updatedOption = await prisma.itemOption.update({
      where: { id: parseInt(optionId) },
      data: { isAvailable: isAvailable === true },
      include: {
        group: {
          include: {
            item: {
              include: {
                category: true,
                optionGroups: {
                  include: { options: true },
                  orderBy: { sortOrder: 'asc' }
                }
              }
            }
          }
        }
      }
    });

    // Extract the full item from the nested include
    const fullItem = updatedOption.group.item;
    res.json(fullItem);
  } catch (error) {
    logger.error('[ToggleOptionError]', { error: error.message, body: req.body });
    res.status(500).json({ error: 'فشل في تحديث حالة الإضافة.' });
  }
};

exports.updateFeaturedItems = async (req, res) => {
  try {
    const { itemIds } = req.body; // Array of item IDs to be featured

    if (!Array.isArray(itemIds)) {
      return res.status(400).json({ error: 'itemIds should be an array' });
    }

    // Run in a transaction: reset all to false, then set the chosen ones to true
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
