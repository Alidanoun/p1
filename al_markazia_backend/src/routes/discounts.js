const express = require('express');
const router = express.Router();
const discountController = require('../controllers/discountController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// 🛡️ Admin Only Routes
router.use(authenticateToken);
router.use(isAdmin); // Only ADMIN can manage discounts

router.get('/campaigns', discountController.getCampaigns);
router.post('/campaigns', discountController.createCampaign);
router.patch('/campaigns/:id/status', discountController.toggleCampaignStatus);
router.delete('/campaigns/:id', discountController.deleteCampaign);

module.exports = router;
