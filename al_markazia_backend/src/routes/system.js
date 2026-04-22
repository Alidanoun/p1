const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

/**
 * 🏛️ Enterprise System Management
 * Restricted to super_admin or admin roles only.
 */

router.get('/identity-check', authenticateToken, systemController.checkIdentityConsistency);

module.exports = router;
