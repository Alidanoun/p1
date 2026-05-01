const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { getLogs, getStats } = require('../controllers/auditController');

const router = express.Router();

/**
 * 🕵️ Audit & Observability Routes
 */

router.get('/logs', authenticateToken, isAdmin, getLogs);
router.get('/stats', authenticateToken, isAdmin, getStats);

module.exports = router;
