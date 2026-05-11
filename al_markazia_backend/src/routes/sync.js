const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');
const { authenticateToken } = require('../middleware/auth');

/**
 * 🛰️ Strategic Consistency Routes
 */

// Reconciliation: Verify if client state is dirty
router.post('/reconcile', authenticateToken, syncController.reconcile);

// Delta Sync: Fetch incremental changes
router.get('/delta', authenticateToken, syncController.getDelta);

module.exports = router;
