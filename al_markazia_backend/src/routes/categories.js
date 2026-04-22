const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getAllCategories, createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');

const router = express.Router();

router.get('/', getAllCategories);
router.post('/', authenticateToken, isAdmin, upload.single('image'), createCategory);
router.put('/:id', authenticateToken, isAdmin, upload.single('image'), updateCategory);
router.delete('/:id', authenticateToken, isAdmin, deleteCategory);

module.exports = router;
