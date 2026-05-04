const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
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

// 🔒 Admin Routes
router.get('/', authenticateToken, isAdmin, deliveryZoneController.getAllZones);
router.post('/', authenticateToken, isAdmin, deliveryZoneController.createZone);
router.put('/:id', authenticateToken, isAdmin, deliveryZoneController.updateZone);
router.delete('/:id', authenticateToken, isAdmin, deliveryZoneController.deleteZone);

module.exports = router;
