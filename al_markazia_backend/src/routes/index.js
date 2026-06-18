/**
 * 🌐 Centralized API Router (v1)
 * All API routes are collected here under a single router
 * and mounted at /api/v1 in server.js.
 * 
 * Legacy routes (without prefix) are also preserved for
 * backward compatibility during the transition period.
 */
const express = require('express');
const router = express.Router();

const { governorGuard } = require('../middleware/governorMiddleware');
const IdempotencyService = require('../services/idempotencyService');

// ─── Route Imports ──────────────────────────────────────────
const authRoutes = require('./auth');
const itemRoutes = require('./items');
const orderRoutes = require('./orders');
const categoryRoutes = require('./categories');
const notificationRoutes = require('./notifications');
const customerRoutes = require('./customers');
const ratingRoutes = require('./ratings');
const reviewsRoutes = require('./reviews');
const settingsRoutes = require('./settings');
const metricsRoutes = require('./metrics');
const analyticsRoutes = require('./analytics');
const systemRoutes = require('./system');
const happyHourRoutes = require('./happyHour');
const deliveryZoneRoutes = require('./deliveryZones');
const dashboardRoutes = require('./dashboard');
const healthCheckRoutes = require('./healthCheck');
const financialRoutes = require('./financial');
const restaurantRoutes = require('./restaurant');
const loyaltyRoutes = require('./loyalty');
const orderModificationRoutes = require('./orderModifications');
const branchRoutes = require('./branch');
const auditRoutes = require('./audit');
const notificationAdminRoutes = require('./notificationAdmin');
const adminRatingsRoutes = require('./adminRatings');
const syncRoutes = require('./sync');

// ─── Route Mounting ─────────────────────────────────────────
// Core Business
const authBiometricRoutes = require('./authBiometric');
router.use('/auth/biometric', authBiometricRoutes);
router.use('/auth', authRoutes);
router.use('/orders', IdempotencyService.guard(), orderRoutes);
router.use('/order-modifications', IdempotencyService.guard(), orderModificationRoutes);
router.use('/items', itemRoutes);
router.use('/categories', categoryRoutes);
router.use('/customers', customerRoutes);

// Operations
router.use('/notifications', notificationRoutes);
router.use('/ratings', ratingRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/settings', settingsRoutes);
router.use('/metrics', metricsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/branch', branchRoutes);
router.use('/restaurant', restaurantRoutes);

// Financial & Analytics
const reportsRoutes = require('./reports');
router.use('/reports', reportsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/financial', financialRoutes);
router.use('/loyalty', loyaltyRoutes);
router.use('/happyhour', happyHourRoutes);

// System & Admin
const path = require('path');
const { searchLimiter } = require('../middleware/rateLimiter');
router.use('/uploads', searchLimiter, express.static(path.join(__dirname, '../../uploads'), {
  index: false, // Disable directory listing
  dotfiles: 'ignore' // Block access to hidden files
}));
router.use('/system', systemRoutes);
router.use('/sync', syncRoutes);
router.use('/admin/audit', auditRoutes);
router.use('/admin/notifications', notificationAdminRoutes);
router.use('/admin/ratings', adminRatingsRoutes);
router.use('/health', healthCheckRoutes);
router.use('/delivery-zones', deliveryZoneRoutes);

module.exports = router;
