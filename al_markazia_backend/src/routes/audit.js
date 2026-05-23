const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { getLogs, getStats } = require('../controllers/auditController');

const router = express.Router();

/**
 * 🕵️ Audit & Observability Routes
 */

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

router.get('/logs', authenticateToken, checkPermission('auditLog', 'VIEW'), BranchAccessMiddleware, getLogs);
router.get('/stats', authenticateToken, checkPermission('auditLog', 'VIEW'), BranchAccessMiddleware, getStats);

module.exports = router;

