const express = require('express');
const router = express.Router();
const { authenticateToken: authMiddleware } = require('../middleware/auth');
const { hasPermission } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { PERMISSIONS } = require('../config/permissions');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');
const markAdminBypass = require('../middleware/markAdminBypass');
const { isAdmin: isAdminMiddleware } = require('../middleware/auth');
const conflictDetection = require('../middleware/conflictDetection');
const idempotency = require('../services/idempotencyService');
const { validateId } = require('../utils/security');
const rateLimit = require('express-rate-limit');

const leadController = require('../controllers/leadController');
const opportunityController = require('../controllers/opportunityController');
const salesActivityController = require('../controllers/salesActivityController');
const customFieldController = require('../controllers/customFieldController');
const crmAnalyticsService = require('../services/crmAnalyticsService');
const response = require('../utils/response');

/**
 * 🎯 CRM Routes (Enterprise-Grade)
 * All routes enforce:
 *  - Authentication
 *  - Permission check (CRM_VIEW / CRM_EDIT)
 *  - Branch isolation (BranchAccessMiddleware → RLS context)
 *  - Idempotency on all mutating operations
 *  - Dual optimistic locking (conflictDetection + DB version check) on stage changes
 */

// Rate limiter for lead creation (prevent spam)
const crmLeadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'RATE_LIMIT', message: 'تجاوزت الحد المسموح به من الطلبات. يرجى المحاولة بعد دقيقة.' }
});

// ─── Leads ───────────────────────────────────────────────────────────────────

router.get(
  '/leads',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  leadController.getLeads
);

router.get(
  '/leads/:id',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  validateId(),
  leadController.getLeadById
);

router.post(
  '/leads',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  crmLeadLimiter,
  idempotency.guard(true),
  leadController.createLead
);

router.patch(
  '/leads/:id',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  idempotency.guard(true),
  validateId(),
  leadController.updateLead
);

router.delete(
  '/leads/:id',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  validateId(),
  leadController.deleteLead
);

router.post(
  '/leads/:id/convert',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  idempotency.guard(true),
  validateId(),
  leadController.convertLead
);

// ─── Opportunities ────────────────────────────────────────────────────────────

router.get(
  '/opportunities',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  opportunityController.getPipeline
);

router.get(
  '/opportunities/:id/history',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  validateId(),
  opportunityController.getHistory
);

router.post(
  '/opportunities',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  idempotency.guard(true),
  opportunityController.createOpportunity
);

router.patch(
  '/opportunities/:id',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  idempotency.guard(true),
  validateId(),
  opportunityController.updateOpportunity
);

router.patch(
  '/opportunities/:id/stage',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  conflictDetection('opportunity'),    // First line of defense (header check)
  idempotency.guard(true),
  validateId(),
  opportunityController.changeStage   // Second line of defense (DB version check)
);

router.patch(
  '/opportunities/:id/reassign',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  idempotency.guard(true),
  validateId(),
  opportunityController.reassign
);

router.delete(
  '/opportunities/:id',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  validateId(),
  opportunityController.deleteOpportunity
);

// ─── Sales Activities ─────────────────────────────────────────────────────────

router.get(
  '/activities',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  salesActivityController.getActivities
);

router.post(
  '/activities',
  authMiddleware, checkPermission('crm', 'EDIT_PIN'), hasPermission(PERMISSIONS.CRM_EDIT), BranchAccessMiddleware,
  idempotency.guard(true),
  salesActivityController.logActivity
);

// Lead timeline (all activities + opportunities for a lead)
router.get(
  '/leads/:id/timeline',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  validateId(),
  salesActivityController.getLeadTimeline
);

// Customer 360° view
router.get(
  '/customers/:id/360',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  validateId(),
  salesActivityController.getCustomer360
);

// ─── Analytics (Admin sees all branches, Manager sees own) ────────────────────

router.get('/analytics/pipeline', authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware, async (req, res) => {
  try {
    const branchId = req.authoritativeBranchId;
    const { startDate, endDate } = req.query;
    const data = await crmAnalyticsService.getPipelineSummary(branchId, { startDate, endDate });
    return response.success(res, data);
  } catch (err) {
    return response.error(res, 'حدث خطأ', 'INTERNAL_ERROR', 500);
  }
});

router.get('/analytics/performance', authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware, async (req, res) => {
  try {
    const branchId = req.authoritativeBranchId;
    const { startDate, endDate } = req.query;
    const data = await crmAnalyticsService.getSalesPerformance(branchId, { startDate, endDate });
    return response.success(res, data);
  } catch (err) {
    return response.error(res, 'حدث خطأ', 'INTERNAL_ERROR', 500);
  }
});

router.get('/analytics/sources', authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware, async (req, res) => {
  try {
    const branchId = req.authoritativeBranchId;
    const { startDate, endDate } = req.query;
    const data = await crmAnalyticsService.getLeadSources(branchId, { startDate, endDate });
    return response.success(res, data);
  } catch (err) {
    return response.error(res, 'حدث خطأ', 'INTERNAL_ERROR', 500);
  }
});

router.get('/analytics/activities', authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware, async (req, res) => {
  try {
    const branchId = req.authoritativeBranchId;
    const { startDate, endDate } = req.query;
    const data = await crmAnalyticsService.getActivitySummary(branchId, { startDate, endDate });
    return response.success(res, data);
  } catch (err) {
    return response.error(res, 'حدث خطأ', 'INTERNAL_ERROR', 500);
  }
});

// ─── Custom Fields Definitions ───────────────────────────────────────────────

// GET definitions for a branch (CRM staff can read them to render forms)
router.get(
  '/custom-fields/definitions/:entityType',
  authMiddleware, checkPermission('crm', 'VIEW'), hasPermission(PERMISSIONS.CRM_VIEW), BranchAccessMiddleware,
  customFieldController.getDefinitions
);

// CRUD for definitions (Restricted to Super Admin only)
router.post(
  '/custom-fields/definitions',
  authMiddleware, isAdminMiddleware,
  idempotency.guard(true),
  customFieldController.createDefinition
);

router.patch(
  '/custom-fields/definitions/:id',
  authMiddleware, isAdminMiddleware,
  idempotency.guard(true),
  validateId(),
  customFieldController.updateDefinition
);

router.delete(
  '/custom-fields/definitions/:id',
  authMiddleware, isAdminMiddleware,
  validateId(),
  customFieldController.deleteDefinition
);

module.exports = router;
