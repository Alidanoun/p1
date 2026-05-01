const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const { getAllCategories, createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');

const { validateId } = require('../utils/security');

const router = express.Router();

router.get('/', getAllCategories);
router.post('/', authenticateToken, isAdmin, uploadImage('image'), createCategory);
router.put('/:id', authenticateToken, isAdmin, validateId(), uploadImage('image'), updateCategory);
router.delete('/:id', authenticateToken, isAdmin, validateId(), deleteCategory);

module.exports = router;
