const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken, isManager } = require('../middleware/auth');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

router.use(authenticateToken);
router.use(isManager);

// 🛡️ Security Check: Reject non-admins trying to access daily reports without specifying branchId
router.get('/daily', (req, res, next) => {
  if (req.user?.role !== 'admin' && !req.query.branchId) {
    return res.status(403).json({
      success: false,
      error: 'ACCESS_DENIED',
      message: 'يجب تحديد رقم الفرع للوصول للتقرير'
    });
  }
  next();
});

router.use(BranchAccessMiddleware);

router.get('/daily', reportController.getDailyReports);
router.get('/top-items', reportController.getTopItems);

module.exports = router;
