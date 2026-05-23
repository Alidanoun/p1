const express = require('express');
const { authenticateToken, isAdmin, isManager } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const deliveryZoneController = require('../controllers/deliveryZoneController');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();

// Public Rate Limiter for Zones (100 requests per IP per minute)
const zonePublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: 'Too many requests' }
});

// 🔓 Public Routes (for Mobile App)
router.get('/active', zonePublicLimiter, deliveryZoneController.getActiveZones);

// 🔒 Admin / Branch Manager Routes
router.get('/', authenticateToken, isManager, checkPermission('deliveryZones', 'VIEW'), deliveryZoneController.getAllZones);
router.post('/', authenticateToken, isManager, checkPermission('deliveryZones', 'EDIT_PIN'), deliveryZoneController.createZone);
router.put('/:id', authenticateToken, isManager, checkPermission('deliveryZones', 'EDIT_PIN'), deliveryZoneController.updateZone);
router.delete('/:id', authenticateToken, isManager, checkPermission('deliveryZones', 'EDIT_PIN'), deliveryZoneController.deleteZone);

module.exports = router;

