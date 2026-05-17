const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { authenticateToken, isAdmin, isManager } = require('../middleware/auth');
const { requireBranchAccess, ensureBranchId } = require('../middleware/branchAuth');

/**
 * 🏢 Branch Management Routes
 * Protected endpoints for branch operations and availability control.
 */

// 📋 List All Branches (Public for apps, Filtered by role for dashboard)
const { optionalAuth } = require('../middleware/auth');
router.get('/', optionalAuth, branchController.getAllBranches);

// 🔄 Toggle Item Availability (Lazy Creation Strategy)
router.post('/items/toggle', 
  authenticateToken, 
  requireBranchAccess, 
  ensureBranchId, 
  branchController.toggleItemAvailability
);

// 🔄 Switch Branch Context (Audit Logged)
router.post('/switch', authenticateToken, branchController.switchBranch);

// 🔍 Validate Branch Access
router.post('/validate', authenticateToken, branchController.validateBranchAccess);

// 🗑️ Soft-Delete Branch (Admin Only)
router.delete('/:id', authenticateToken, isAdmin, branchController.deleteBranch);

module.exports = router;
