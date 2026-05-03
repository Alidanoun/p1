const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { requireBranchAccess, ensureBranchId } = require('../middleware/branchAuth');

/**
 * 🏢 Branch Management Routes
 * Protected endpoints for branch operations and availability control.
 */

// 📋 List All Branches (Only Admin/SuperAdmin can see all)
router.get('/', authenticateToken, isAdmin, branchController.getAllBranches);

// 🔄 Toggle Item Availability (Lazy Creation Strategy)
router.post('/items/toggle', 
  authenticateToken, 
  requireBranchAccess, 
  ensureBranchId, 
  branchController.toggleItemAvailability
);

module.exports = router;
