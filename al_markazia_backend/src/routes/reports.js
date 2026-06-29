const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken, isManager } = require('../middleware/auth');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

router.use(authenticateToken);
router.use(isManager);
router.use(BranchAccessMiddleware);

router.get('/daily', reportController.getDailyReports);
router.get('/top-items', reportController.getTopItems);

module.exports = router;
