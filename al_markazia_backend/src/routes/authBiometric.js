const express = require('express');
const router = express.Router();
const authBiometricController = require('../controllers/authBiometricController');
const { authenticateToken } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Biometric Trust
 *   description: Persistent hardware-level biometric authentication endpoints
 */

// 1. Enable/Register persistent hardware binding (Requires active session)
router.post('/enable', authenticateToken, authBiometricController.enableBiometric);

// 2. Unlock/Authenticate via hardware credentials (Bypasses Redis session cache checks)
router.post('/unlock', authBiometricController.unlockBiometric);

// 3. Disable/Revoke specific hardware binding (Requires active session)
router.post('/disable', authenticateToken, authBiometricController.disableBiometric);

module.exports = router;
