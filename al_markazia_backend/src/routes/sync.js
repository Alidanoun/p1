const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');
const { authMiddleware } = require('../middleware/auth');

/**
 * 🛰️ Strategic Consistency Routes
 */

// Reconciliation: Verify if client state is dirty
router.post('/reconcile', authMiddleware, syncController.reconcile);

// Delta Sync: Fetch incremental changes
router.get('/delta', authMiddleware, syncController.getDelta);

module.exports = router;
