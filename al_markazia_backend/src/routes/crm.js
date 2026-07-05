const express = require('express');
const router = express.Router();
const { authenticateToken: authMiddleware } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { hasPermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');
const conflictDetection = require('../middleware/conflictDetection');
const idempotency = require('../services/idempotencyService');
const { validateId } = require('../utils/security');

const leadController = require('../controllers/leadController');
const opportunityController = require('../controllers/opportunityController');

/**
 * 🎯 CRM Routes
 * All routes enforce:
 *  - Authentication (authMiddleware)
 *  - Permission check (CRM_VIEW / CRM_EDIT)
 *  - Branch isolation (BranchAccessMiddleware → sets req.authoritativeBranchId + RLS context)
 *  - Idempotency (idempotency.guard) on all mutating operations
 *  - Optimistic locking (conflictDetection) on stage changes
 */

// ─── Leads ───────────────────────────────────────────────────────────────────

router.get(
  '/leads',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_VIEW),
  BranchAccessMiddleware,
  leadController.getLeads
);

router.post(
  '/leads',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_EDIT),
  BranchAccessMiddleware,
  idempotency.guard(true),
  leadController.createLead
);

router.post(
  '/leads/:id/convert',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_EDIT),
  BranchAccessMiddleware,
  idempotency.guard(true),
  validateId(),
  leadController.convertLead
);

// ─── Opportunities ────────────────────────────────────────────────────────────

router.get(
  '/opportunities',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_VIEW),
  BranchAccessMiddleware,
  opportunityController.getPipeline
);

router.post(
  '/opportunities',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_EDIT),
  BranchAccessMiddleware,
  idempotency.guard(true),
  opportunityController.createOpportunity
);

router.patch(
  '/opportunities/:id/stage',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_EDIT),
  BranchAccessMiddleware,
  conflictDetection('opportunity'), // Read-then-compare (first line of defense)
  idempotency.guard(true),
  validateId(),
  opportunityController.changeStage   // Atomic DB version check (second line of defense)
);

router.get(
  '/opportunities/:id/history',
  authMiddleware,
  hasPermission(PERMISSIONS.CRM_VIEW),
  BranchAccessMiddleware,
  validateId(),
  opportunityController.getHistory
);

module.exports = router;
