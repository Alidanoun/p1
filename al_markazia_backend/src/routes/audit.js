const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { getLogs, getStats } = require('../controllers/auditController');

const router = express.Router();

/**
 * 🕵️ Audit & Observability Routes
 */

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

router.get('/logs', authenticateToken, BranchAccessMiddleware, getLogs);
router.get('/stats', authenticateToken, BranchAccessMiddleware, getStats);

module.exports = router;
