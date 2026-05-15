
const prisma = require('../lib/prisma');
const { deleteFile } = require('../utils/fileUploadHelper');
const logger = require('../utils/logger');
const imageService = require('../services/imageService');

exports.getAllCategories = async (req, res) => {
  try {
    const { admin } = req.query;
    const filter = admin === 'true' ? { isDeleted: false } : { isActive: true, isDeleted: false };
    const categories = await prisma.category.findMany({
      where: filter,
      orderBy: { sortOrder: 'asc' }
    });
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    logger.error('Failed to fetch categories', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, nameEn, description, descriptionEn, sortOrder, isActive } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'اسم الفئة مطلوب' });
    }

    let imageUrl = null;
    if (req.file) {
      const processed = await imageService.processMenuImage(req.file.filename);
      imageUrl = processed ? processed.medium : `/uploads/${req.file.filename}`;
    }

    const category = await prisma.category.create({
      data: {
        name,
        nameEn: nameEn || null,
        description: description || '',
        descriptionEn: descriptionEn || null,
        image: imageUrl,
        sortOrder: parseInt(sortOrder) || 0,
        isActive: isActive === 'false' || isActive === false ? false : true
      }
    });

    logger.info('Category created', { name: category.name, categoryId: category.id });
    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Create category error', { error: error.message, body: req.body });
    res.status(500).json({ success: false, error: 'فشل في إنشاء الفئة' });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, nameEn, description, descriptionEn, sortOrder, isActive, version } = req.body;
    
    const existingCategory = await prisma.category.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existingCategory) return res.status(404).json({ success: false, error: 'Category not found' });

    // 🛡️ [PHASE 1] Optimistic Concurrency Guard
    if (version !== undefined && parseInt(version) !== existingCategory.version) {
      return res.status(409).json({ 
        success: false, 
        error: '⚠️ تضارب في البيانات: تم تعديل هذه الفئة من قبل مستخدم آخر.',
        currentVersion: existingCategory.version
      });
    }

    const updateData = { version: { increment: 1 } };
    if (name !== undefined) updateData.name = name;
    if (nameEn !== undefined) updateData.nameEn = nameEn || null;
    if (description !== undefined) updateData.description = description;
    if (descriptionEn !== undefined) updateData.descriptionEn = descriptionEn || null;
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder);
    
    if (isActive !== undefined) {
      updateData.isActive = (isActive === 'true' || isActive === true);
    }


    if (req.file) {
      try {
        const processed = await imageService.processMenuImage(req.file.filename);
        updateData.image = processed ? processed.medium : `/uploads/${req.file.filename}`;

        // Delete old image if exists
        if (existingCategory?.image) {
          deleteFile(existingCategory.image);
        }
      } catch (err) {
        logger.error('[UpdateCategory] Image processing error', { error: err.message, categoryId: id });
      }
    }

    const updatedCategory = await prisma.category.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    logger.info('Category updated', { categoryId: id, name: updatedCategory.name });
    res.json({
      success: true,
      data: updatedCategory
    });
  } catch (error) {
    logger.error('Update category error', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: 'فشل في تحديث الفئة' });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if category has items before deleting
    const itemsCount = await prisma.item.count({ where: { categoryId: parseInt(id) } });
    if (itemsCount > 0) {
      logger.warn('Attempt to delete category with active items', { categoryId: id, count: itemsCount });
      return res.status(400).json({ error: `Cannot delete category with ${itemsCount} active items. Remove items first.` });
    }

    // 1. Get image path before deleting
    const category = await prisma.category.findUnique({
      where: { id: parseInt(id) },
      select: { image: true }
    });

    // 2. Atomic Soft Delete Cascade
    await prisma.$transaction(async (tx) => {
      // Soft-delete the category
      await tx.category.update({ 
        where: { id: parseInt(id) },
        data: { isDeleted: true, deletedAt: new Date() }
      });

      // Soft-delete all items in this category
      const affectedItems = await tx.item.updateMany({
        where: { categoryId: parseInt(id), isDeleted: false },
        data: { isDeleted: true, deletedAt: new Date() }
      });

      logger.info('Category and associated items soft-deleted', { 
        categoryId: id, 
        itemsAffected: affectedItems.count 
      });
    });

    // 3. Delete physical file
    if (category?.image) {
      deleteFile(category.image);
    }

    logger.info('Category deleted', { categoryId: id });
    res.json({ message: 'Category deleted successfully and image cleaned up' });
  } catch (error) {
    logger.error('Delete category error', { error: error.message, categoryId: req.params.id });
    res.status(500).json({ error: 'Failed to delete category' });
  }
};
