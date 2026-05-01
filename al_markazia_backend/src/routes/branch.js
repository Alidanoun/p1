const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { authenticateToken } = require('../middleware/auth');

/**
 * 🏢 Branch Management Routes
 * Protected endpoints for branch operations and availability control.
 */

// 📋 List All Branches
router.get('/', authenticateToken, branchController.getAllBranches);

// 🔄 Toggle Item Availability (Lazy Creation Strategy)
router.post('/items/toggle', authenticateToken, branchController.toggleItemAvailability);

module.exports = router;
