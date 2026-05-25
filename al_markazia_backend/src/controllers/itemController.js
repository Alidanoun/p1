const prisma = require('../lib/prisma');
const { deleteFile, formatImageUrl } = require('../utils/fileUploadHelper');
const logger = require('../utils/logger');
const itemFilters = require('../utils/itemFilters');
const { toNumber } = require('../utils/number');
const { safeJsonParse } = require('../utils/security');
const menuCacheService = require('../services/menuCacheService');
const imageService = require('../services/imageService');
const menuResolver = require('../utils/menuResolver');

exports.getAllItems = async (req, res) => {
  try {
    const { admin, categoryId, featured, query } = req.query;
    
    let targetBranchId = req.query.branchId || req.user?.branchId || null;
    if (targetBranchId === 'null' || targetBranchId === 'undefined') targetBranchId = null;

    // ⚡ [PHASE 2/3] Branch-Aware Cache Check
    if (admin !== 'true' && !categoryId && !featured && !query) {
      const currentETag = await menuCacheService.getETag(targetBranchId || 'global');
      if (currentETag && req.headers['if-none-match'] === currentETag) {
        return res.status(304).end();
      }

      // Check Redis Snapshot per branch
      const cachedMenu = await menuCacheService.getMenu(targetBranchId || 'global');
      if (cachedMenu) {
        res.setHeader('ETag', currentETag);
        return res.json({ success: true, data: JSON.parse(cachedMenu), cached: true });
      }
    }

    let filter;

    if (admin === 'true') {
      filter = itemFilters.getAdminPanelFilter();
    } else if (featured === 'true') {
      filter = itemFilters.getFeaturedSectionFilter();
    } else {
      filter = itemFilters.getPublicMenuFilter();
    }

    if (categoryId) filter.categoryId = parseInt(categoryId);

    // 🔍 Search Query Support
    if (query) {
      const normalizedQuery = query.toLowerCase();
      filter.OR = [
        { title: { contains: normalizedQuery, mode: 'insensitive' } },
        { titleEn: { contains: normalizedQuery, mode: 'insensitive' } },
        { description: { contains: normalizedQuery, mode: 'insensitive' } }
      ];
    }

    // 📐 Pagination & Selective Querying
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const includeOptions = {
      category: { select: { id: true, name: true, nameEn: true } },
      variants: { where: { isAvailable: true } }
    };

    // Only include modifierGroups if explicitly requested or if it's the admin panel
    // (In a future optimization, this could be lazy-loaded on expand)
    includeOptions.modifierGroups = {
      where: { isActive: true },
      include: {
        modifiers: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
      },
      orderBy: { sortOrder: 'asc' }
    };

    if (targetBranchId) {
      includeOptions.branchItems = {
        where: { branchId: targetBranchId },
        select: { isAvailable: true, branchId: true }
      };

      // 🧬 [PHASE 3] Resolve Staged Publishing
      // Item is visible if: (isGlobal = true) OR (Assigned to this branch)
      filter.AND = [
        ...(filter.AND || []),
        {
          OR: [
            { isGlobal: true },
            { branchItems: { some: { branchId: targetBranchId } } }
          ]
        }
      ];

      // Also include BranchVariant overrides
      includeOptions.variants = {
        include: {
          branchVariants: {
            where: { branchId: targetBranchId },
            select: { isAvailable: true }
          }
        }
      };
    }

    const [items, totalCount] = await Promise.all([
      prisma.item.findMany({
        where: filter,
        include: includeOptions,
        orderBy: [
          { isFeatured: 'desc' },
          { createdAt: 'desc' }
        ],
        skip,
        take: limit
      }),
      prisma.item.count({ where: filter })
    ]);

    const mappedItems = items.map(item => {
      const branchItem = item.branchItems?.[0] || null;
      const finalAvailability = menuResolver.resolveItemAvailability(item, branchItem);

      // 🧬 [PHASE 3] Resolve Branch-Specific Variant Availability via Central Resolver
      const resolvedVariants = (item.variants || []).map(v => {
        const branchVariant = v.branchVariants?.[0] || null;
        const variantAvailability = menuResolver.resolveVariantAvailability(
          item, 
          v, 
          branchItem, 
          branchVariant
        );

        return {
          ...v,
          isAvailable: variantAvailability,
          branchVariants: undefined
        };
      });

      const optionGroups = (item.modifierGroups || []).map(g => ({
        ...g,
        options: (g.modifiers || []).map(m => ({
          ...m,
          price: toNumber(m.price)
        }))
      }));

      return {
        ...item,
        isAvailable: finalAvailability,
        variants: resolvedVariants,
        image: formatImageUrl(item.image),
        basePrice: toNumber(item.basePrice),
        optionGroups,
        branchItems: undefined
      };
    });

    // ⚡ [PHASE 2/3] Warmup Cache per branch if this is the full menu
    if (admin !== 'true' && !categoryId && !featured && !query && page === 1) {
      const branchKey = targetBranchId || 'global';
      await menuCacheService.setMenu(mappedItems, branchKey);
      const etag = await menuCacheService.getETag(branchKey);
      if (etag) res.setHeader('ETag', etag);
    }

    res.json({ 
      success: true, 
      data: mappedItems,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
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
          { isDeleted: false },
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
    const item = await prisma.item.findFirst({
      where: { 
        id: parseInt(id),
        isDeleted: false
      },
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
    
    const optionGroups = (item.modifierGroups || []).map(g => ({
      ...g,
      options: (g.modifiers || []).map(m => ({
        ...m,
        price: toNumber(m.price)
      }))
    }));

    res.json({
      ...item,
      basePrice: toNumber(item.basePrice),
      optionGroups,
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
      modifierGroups,
      optionGroups,
      isGlobal
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
    const inputGroups = modifierGroups || optionGroups;
    if (inputGroups) {
      parsedGroups = typeof inputGroups === 'string' ? safeJsonParse(inputGroups) : inputGroups;
    }

    let parsedVariants = [];
    if (variants) {
      parsedVariants = typeof variants === 'string' ? safeJsonParse(variants) : variants;
    }

    // 🛡️ [SEC-FIX] Pre-validate option prices before transaction
    if (parsedGroups.length > 0) {
      for (const group of parsedGroups) {
        const opts = group.options || group.modifiers || [];
        for (const opt of opts) {
          const optPrice = parseFloat(opt.price);
          if (isNaN(optPrice) || optPrice < 0) {
            return res.status(400).json({ error: `سعر الإضافة "${opt.name}" غير صحيح، يرجى إدخال رقم موجب` });
          }
        }
      }
    }

    const parsedIsGlobal = isGlobal === undefined ? true : (isGlobal === 'true' || isGlobal === true);

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
          isGlobal: parsedIsGlobal,
          variants: {
            create: parsedVariants.map(v => ({
              name: v.name,
              nameEn: v.nameEn,
              priceDiff: parseFloat(v.priceDiff) || 0,
              isDefault: v.isDefault || false
            }))
          },
          modifierGroups: {
            create: parsedGroups.map(group => {
              const opts = group.options || group.modifiers || [];
              return {
                groupName: group.groupName,
                groupNameEn: group.groupNameEn,
                type: group.type || 'SINGLE',
                isRequired: group.isRequired || false,
                minSelection: parseInt(group.minSelection) || 0,
                maxSelection: parseInt(group.maxSelection) || 1,
                modifiers: {
                  create: opts.map(mod => ({
                    name: mod.name,
                    nameEn: mod.nameEn,
                    price: parseFloat(mod.price) || 0,
                    isDefault: mod.isDefault || false,
                    isAvailable: mod.isAvailable !== false
                  }))
                }
              };
            })
          }
        },
        include: {
          category: { select: { id: true, name: true, nameEn: true } },
          variants: true,
          modifierGroups: { include: { modifiers: true } }
        }
      });

      // 🔄 Auto-link to all active branches if isGlobal is true
      if (newItem.isGlobal) {
        const activeBranches = await tx.branch.findMany({ where: { isActive: true } });
        if (activeBranches.length > 0) {
          await tx.branchItem.createMany({
            data: activeBranches.map(b => ({
              branchId: b.id,
              itemId: newItem.id,
              isAvailable: true,
              stockCount: -1
            })),
            skipDuplicates: true
          });
        }
      }

      const mappedGroups = (newItem.modifierGroups || []).map(g => ({
        ...g,
        options: (g.modifiers || []).map(m => ({ ...m, price: toNumber(m.price) }))
      }));

      return {
        ...newItem,
        basePrice: toNumber(newItem.basePrice),
        optionGroups: mappedGroups
      };
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
      removeImage,
      variants,
      optionGroups,
      modifierGroups,
      version
    } = req.body;

    const currentItem = await prisma.item.findFirst({ 
      where: { 
        id: parseInt(id),
        isDeleted: false
      } 
    });
    if (!currentItem) return res.status(404).json({ success: false, error: 'Item not found or has been deleted' });

    // 🛡️ [PHASE 1] Optimistic Concurrency Guard
    if (version !== undefined && parseInt(version) !== currentItem.version) {
      return res.status(409).json({ 
        success: false, 
        error: '⚠️ تضارب في البيانات: تم تعديل هذا الصنف من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.',
        currentVersion: currentItem.version
      });
    }

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
    const inputGroups = modifierGroups || optionGroups;
    if (inputGroups) {
      parsedGroups = typeof inputGroups === 'string' ? safeJsonParse(inputGroups) : inputGroups;

      // 🛡️ [SEC-FIX] Pre-validate option prices
      for (const group of parsedGroups) {
        const opts = group.options || group.modifiers || [];
        for (const opt of opts) {
          const optPrice = parseFloat(opt.price);
          if (isNaN(optPrice) || optPrice < 0) {
            return res.status(400).json({ error: `سعر الإضافة "${opt.name}" غير صحيح، يرجى إدخال رقم موجب` });
          }
        }
      }
    }

    let parsedVariants = [];
    if (variants) {
      parsedVariants = typeof variants === 'string' ? safeJsonParse(variants) : variants;
    }

    const parsedPrice = toNumber(basePrice, -1);

    const updatedItem = await prisma.$transaction(async (tx) => {
      // 1. 🛡️ Update base item & increment version
      const item = await tx.item.update({
        where: { id: parseInt(id) },
        data: {
          title: title !== undefined ? title : undefined,
          titleEn: titleEn !== undefined ? titleEn : undefined,
          description: description !== undefined ? description : undefined,
          descriptionEn: descriptionEn !== undefined ? descriptionEn : undefined,
          basePrice: parsedPrice >= 0 ? parsedPrice : undefined,
          categoryId: categoryId ? parseInt(categoryId) : undefined,
          isAvailable: isAvailable !== undefined ? (isAvailable === 'true' || isAvailable === true) : undefined,
          isFeatured: isFeatured !== undefined ? (isFeatured === 'true' || isFeatured === true) : undefined,
          excludeFromStats: excludeFromStats !== undefined ? (excludeFromStats === 'true' || excludeFromStats === true) : undefined,
          preparationTime: preparationTime !== undefined ? (preparationTime ? parseInt(preparationTime) : null) : undefined,
          image: imageUrl,
          version: { increment: 1 }
        }
      });

      // 2. 🧬 [PHASE 1] Surgical Variant Update
      if (variants) {
        const incomingVariantIds = parsedVariants.filter(v => v.id).map(v => parseInt(v.id));
        
        // 🗑️ Delete removed variants
        await tx.itemVariant.deleteMany({
          where: { itemId: item.id, NOT: { id: { in: incomingVariantIds } } }
        });

        // 🔄 Upsert remaining/new variants
        for (const v of parsedVariants) {
          if (v.id) {
            await tx.itemVariant.update({
              where: { id: parseInt(v.id) },
              data: {
                name: v.name,
                nameEn: v.nameEn,
                priceDiff: parseFloat(v.priceDiff) || 0,
                isAvailable: v.isAvailable !== false
              }
            });
          } else {
            await tx.itemVariant.create({
              data: {
                itemId: item.id,
                name: v.name,
                nameEn: v.nameEn,
                priceDiff: parseFloat(v.priceDiff) || 0,
                isAvailable: v.isAvailable !== false,
                isDefault: v.isDefault || false
              }
            });
          }
        }
      }

      // 3. 🧬 [PHASE 1] Surgical Modifier Group Update
      if (inputGroups) {
        const incomingGroupIds = parsedGroups.filter(g => g.id).map(g => parseInt(g.id));

        // 🗑️ Delete removed groups
        await tx.modifierGroup.deleteMany({
          where: { itemId: item.id, NOT: { id: { in: incomingGroupIds } } }
        });

        for (let gIdx = 0; gIdx < parsedGroups.length; gIdx++) {
          const group = parsedGroups[gIdx];
          const opts = group.options || group.modifiers || [];
          let groupId;

          const groupData = {
            groupName: group.groupName,
            groupNameEn: group.groupNameEn,
            type: group.type || 'SINGLE',
            isRequired: group.isRequired || false,
            minSelection: parseInt(group.minSelection) || 0,
            maxSelection: parseInt(group.maxSelection) || 1,
            isActive: group.isActive !== false,
            sortOrder: group.sortOrder !== undefined ? parseInt(group.sortOrder) : gIdx
          };

          if (group.id) {
            groupId = parseInt(group.id);
            await tx.modifierGroup.update({
              where: { id: groupId },
              data: groupData
            });
          } else {
            const newGroup = await tx.modifierGroup.create({
              data: {
                itemId: item.id,
                ...groupData
              }
            });
            groupId = newGroup.id;
          }

          // 🧬 Surgical Modifier Update within Group
          const incomingModIds = opts.filter(m => m.id).map(m => parseInt(m.id));
          await tx.itemModifier.deleteMany({
            where: { groupId, NOT: { id: { in: incomingModIds } } }
          });

          for (let mIdx = 0; mIdx < opts.length; mIdx++) {
            const mod = opts[mIdx];
            const modData = {
              name: mod.name,
              nameEn: mod.nameEn,
              price: parseFloat(mod.price) || 0,
              isAvailable: mod.isAvailable !== false,
              isDefault: mod.isDefault || false,
              sortOrder: mod.sortOrder !== undefined ? parseInt(mod.sortOrder) : mIdx
            };

            if (mod.id) {
              await tx.itemModifier.update({
                where: { id: parseInt(mod.id) },
                data: modData
              });
            } else {
              await tx.itemModifier.create({
                data: {
                  groupId,
                  ...modData
                }
              });
            }
          }
        }
      }

      logger.info('Item updated surgically', { 
        itemId: item.id, 
        version: item.version + 1,
        variantsCount: parsedVariants.length,
        groupsCount: parsedGroups.length
      });

      return await tx.item.findUnique({
        where: { id: item.id },
        include: {
          category: { select: { id: true, name: true, nameEn: true } },
          variants: true,
          modifierGroups: { include: { modifiers: true } }
        }
      });
    });

    await menuCacheService.invalidate();

    const mappedGroups = (updatedItem.modifierGroups || []).map(g => ({
      ...g,
      options: (g.modifiers || []).map(m => ({ ...m, price: toNumber(m.price) }))
    }));

    res.json({
      success: true,
      data: {
        ...updatedItem,
        basePrice: toNumber(updatedItem.basePrice),
        optionGroups: mappedGroups
      }
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

    await prisma.item.update({ 
      where: { id: parseInt(id) },
      data: { isDeleted: true, deletedAt: new Date() }
    });
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

    const updatedItem = await prisma.item.updateMany({
      where: { id: parseInt(id), isDeleted: false },
      data: { isAvailable: isAvailable === true }
    });

    if (updatedItem.count === 0) {
      return res.status(404).json({ success: false, error: 'Item not found or deleted' });
    }

    await menuCacheService.invalidate();
    const item = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, error: 'فشل في تحديث حالة الصنف.' });
  }
};

exports.toggleGroupActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const updatedGroup = await prisma.modifierGroup.update({
      where: { id: parseInt(id) },
      data: { isActive: isActive === true },
      include: {
        item: {
          include: {
            category: true,
            modifierGroups: {
              where: { isActive: true },
              include: {
                modifiers: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
              },
              orderBy: { sortOrder: 'asc' }
            }
          }
        }
      }
    });

    await menuCacheService.invalidate();

    const item = updatedGroup.item;
    const optionGroups = (item.modifierGroups || []).map(g => ({
      ...g,
      options: (g.modifiers || []).map(m => ({
        ...m,
        price: toNumber(m.price)
      }))
    }));

    res.json({ 
      success: true, 
      data: {
        ...item,
        basePrice: toNumber(item.basePrice),
        optionGroups,
        image: formatImageUrl(item.image)
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'فشل في تحديث حالة المجموعة.' });
  }
};

const toggleOptionAvailable = async (req, res) => {
  try {
    const { optionId, isAvailable } = req.body;
    const targetId = optionId ? parseInt(optionId) : parseInt(req.params.id);

    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, error: 'معرف الخيار غير صحيح' });
    }

    const updatedOption = await prisma.itemModifier.update({
      where: { id: targetId },
      data: { isAvailable: isAvailable === true },
      include: {
        group: {
          include: {
            item: {
              include: {
                category: true,
                modifierGroups: {
                  where: { isActive: true },
                  include: {
                    modifiers: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } }
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

    const item = updatedOption.group.item;
    const optionGroups = (item.modifierGroups || []).map(g => ({
      ...g,
      options: (g.modifiers || []).map(m => ({
        ...m,
        price: toNumber(m.price)
      }))
    }));

    res.json({ 
      success: true, 
      data: {
        ...item,
        basePrice: toNumber(item.basePrice),
        optionGroups,
        image: formatImageUrl(item.image)
      } 
    });
  } catch (error) {
    logger.error('[ToggleOptionError]', { error: error.message, body: req.body });
    res.status(500).json({ success: false, error: 'فشل في تحديث حالة الإضافة.' });
  }
};

exports.toggleOptionAvailable = toggleOptionAvailable;
exports.toggleOptionAvailability = toggleOptionAvailable;

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

    const updatedItem = await prisma.item.updateMany({
      where: { id: parseInt(id), isDeleted: false },
      data: { excludeFromStats: exclude === true }
    });

    if (updatedItem.count === 0) {
      return res.status(404).json({ success: false, error: 'Item not found or deleted' });
    }

    logger.info('Item exclusion toggled', { itemId: id, exclude: exclude === true });
    const item = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    res.json({ success: true, data: item });
  } catch (error) {
    logger.error('[ToggleExclusionError]', { error: error.message, itemId: req.params.id });
    res.status(500).json({ success: false, error: 'فشل في تعديل حالة استبعاد الصنف.' });
  }
};

exports.toggleVariantAvailability = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { branchId, isAvailable, version } = req.body;

    if (!branchId || isAvailable === undefined) {
      return res.status(400).json({ error: 'Missing branchId or isAvailable' });
    }

    const variant = await prisma.itemVariant.findUnique({
      where: { id: parseInt(variantId) },
      include: { item: true }
    });

    if (!variant) return res.status(404).json({ error: 'Variant not found' });

    // 🧬 [PHASE 3] Lazy Override Strategy
    // Only persist if it deviates from the global ItemVariant state
    const isGlobalDefault = variant.isAvailable;
    
    if (isAvailable === isGlobalDefault) {
      // Reverting to default: Delete the override if it exists
      await prisma.branchVariant.deleteMany({
        where: {
          branchId,
          variantId: variant.id
        }
      });
      logger.info('[ToggleVariant] Reverted to global default', { variantId, branchId });
    } else {
      // Deviating: Upsert the override
      const existingOverride = await prisma.branchVariant.findUnique({
        where: { branchId_variantId: { branchId, variantId: variant.id } }
      });

      if (existingOverride && version !== undefined && existingOverride.version !== version) {
        return res.status(409).json({ error: 'تضارب في البيانات (نسخة قديمة)' });
      }

      await prisma.branchVariant.upsert({
        where: { branchId_variantId: { branchId, variantId: variant.id } },
        update: { 
          isAvailable,
          version: { increment: 1 }
        },
        create: {
          branchId,
          variantId: variant.id,
          isAvailable,
          version: 1
        }
      });
      logger.info('[ToggleVariant] Persistence: Branch override created/updated', { variantId, branchId, isAvailable });
    }

    await menuCacheService.invalidate(branchId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Toggle variant error', { error: error.message });
    res.status(500).json({ error: 'Failed to toggle variant availability' });
  }
};
