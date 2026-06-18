const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

const getDailyReports = async (req, res) => {
  try {
    const { branchId, days = 7 } = req.query;
    
    let whereClause = {};
    if (branchId) {
      whereClause.branchId = branchId;
    }
    
    // Date filter: past 'days'
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - parseInt(days, 10));
    whereClause.date = { gte: pastDate };

    const reports = await prisma.dailyReport.findMany({
      where: whereClause,
      orderBy: { date: 'asc' },
      include: {
        branch: { select: { name: true } }
      }
    });

    res.json(reports);
  } catch (err) {
    logger.error(`[getDailyReports] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
};

const getTopItems = async (req, res) => {
  try {
    // A quick aggregation based on recent orders
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30); // Last 30 days
    
    const items = await prisma.orderItem.groupBy({
      by: ['title'],
      where: {
        order: {
          createdAt: { gte: pastDate },
          status: 'delivered'
        }
      },
      _sum: {
        quantity: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 5
    });

    res.json(items);
  } catch (err) {
    logger.error(`[getTopItems] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch top items' });
  }
};

module.exports = {
  getDailyReports,
  getTopItems
};
