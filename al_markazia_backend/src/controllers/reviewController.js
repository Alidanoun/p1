
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');

// Customer: Submit a new review
const submitReview = async (req, res) => {
  try {
    const { itemId, customerName, rating, comment } = req.body;
    
    if (!itemId) return res.status(400).json({ error: 'Item ID is required' });
    if (!customerName || !rating) return res.status(400).json({ error: 'Name and rating are required' });
    
    const numRating = parseInt(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const review = await prisma.review.create({
      data: {
        itemId: parseInt(itemId),
        customerName,
        rating: numRating,
        comment,
        isApproved: false // Hidden by default
      }
    });

    // Optionally ping admins through websocket about new review
    const io = req.app.get('io');
    if (io) {
      io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.NEW_REVIEW, { review, message: 'طلب تقييم جديد قيد الانتظار' });
    }

    res.status(201).json({ message: 'Review submitted successfully', review });
  } catch (error) {
    logger.error('Error submitting review:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
};

// Customer/App: Fetch approved reviews for a specific item
const getItemReviews = async (req, res) => {
  try {
    const { itemId } = req.params;
    const reviews = await prisma.review.findMany({
      where: {
        itemId: parseInt(itemId),
        isApproved: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(reviews);
  } catch (error) {
    logger.error('Error fetching item reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

// Admin: Fetch all reviews (Unified: Item reviews + Order ratings)
const getAllReviews = async (req, res) => {
  try {
    // 1. Fetch Item Reviews
    const itemReviews = await prisma.review.findMany({
      include: {
        item: {
          select: { title: true, id: true, image: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const mappedItemReviews = itemReviews.map(r => ({
      ...r,
      type: 'item_review',
      // Ensure specific fields exist for consistency
      orderId: null,
      customerPhone: null,
      fullOrder: null
    }));

    // 2. Fetch Orders with ratings
    const orderRatings = await prisma.order.findMany({
      where: {
        rating: { not: null }
      },
      include: {
        orderItems: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const mappedOrderRatings = orderRatings.map(o => ({
      id: `order-${o.id}`, // Custom prefix for frontend keys
      realId: o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      rating: o.rating,
      comment: o.ratingComment,
      isApproved: o.isRatingApproved,
      type: 'order_rating',
      createdAt: o.createdAt,
      orderNumber: o.orderNumber,
      // Pass the whole order object for the invoice modal
      fullOrder: {
        ...o,
        cartItems: o.orderItems.map(oi => {
          let optionsText = oi.selectedOptions || '';
          try {
            const parsed = JSON.parse(oi.selectedOptions);
            if (Array.isArray(parsed)) {
              optionsText = parsed.map(opt => opt.name).join(', ');
            }
          } catch (e) {
            // Keep original string if it's not JSON
          }
          return {
            qty: oi.quantity,
            title: oi.itemName,
            price: oi.unitPrice,
            totalPrice: oi.lineTotal,
            optionsText: optionsText
          };
        })
      }
    }));

    // 3. Combine and sort
    const allReviews = [...mappedItemReviews, ...mappedOrderRatings].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json(allReviews);
  } catch (error) {
    logger.error('Error fetching all reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

// Admin: Approve or hide a review (Unified: Item review or Order rating)
const toggleApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;

    if (typeof id === 'string' && id.startsWith('order-')) {
      const realId = parseInt(id.replace('order-', ''));
      const order = await prisma.order.update({
        where: { id: realId },
        data: { isRatingApproved: Boolean(isApproved) }
      });
      return res.json({ id: `order-${order.id}`, isApproved: order.isRatingApproved });
    }

    const review = await prisma.review.update({
      where: { id: parseInt(id) },
      data: { isApproved: Boolean(isApproved) }
    });
    res.json(review);
  } catch (error) {
    logger.error('Error updating review:', error);
    res.status(500).json({ error: 'Failed to update review' });
  }
};

// Admin: Delete a review
const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.review.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    logger.error('Error deleting review:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
};

module.exports = {
  submitReview,
  getItemReviews,
  getAllReviews,
  toggleApproval,
  deleteReview
};
