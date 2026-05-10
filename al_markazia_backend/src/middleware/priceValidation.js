const prisma = require('../lib/prisma');
const MenuPriceEngine = require('../services/menuPriceEngine');
const logger = require('../utils/logger');

/**
 * 🛡️ Price Validation Middleware
 * Ensures the price sent by the client matches the server-calculated price.
 */
const priceValidationMiddleware = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return next();

    for (const orderItem of items) {
      const itemData = await prisma.item.findUnique({
        where: { id: orderItem.itemId },
        include: {
          variants: true,
          modifierGroups: {
            include: { modifiers: true }
          }
        }
      });

      if (!itemData) {
        return res.status(404).json({ message: `Item not found: ${orderItem.itemId}` });
      }

      // 1. Validate Selection Logic (Min/Max/Required)
      const validation = MenuPriceEngine.validateSelection(itemData, orderItem.modifierIds || []);
      if (!validation.isValid) {
        return res.status(400).json({ message: validation.error });
      }

      // 2. Recalculate Price
      const serverPrice = MenuPriceEngine.calculateFinalPrice(
        itemData, 
        orderItem.variantId, 
        orderItem.modifierIds || []
      );

      // 3. Compare with client-sent price (if provided)
      // Note: We usually trust the server price, but if the client sends a price
      // for UI display, we must ensure it's not being spoofed.
      if (orderItem.unitPrice && Math.abs(serverPrice - parseFloat(orderItem.unitPrice)) > 0.01) {
        logger.warn('[PriceValidation] 🚨 Price mismatch detected!', {
          itemId: orderItem.itemId,
          clientPrice: orderItem.unitPrice,
          serverPrice
        });
        return res.status(400).json({ 
          message: `Price mismatch for item ${itemData.title}. Expected ${serverPrice}, got ${orderItem.unitPrice}` 
        });
      }

      // Inject server-calculated price to req.body for safe processing in controllers
      orderItem.validatedUnitPrice = serverPrice;
    }

    next();
  } catch (err) {
    logger.error('[PriceValidation] Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error during price validation' });
  }
};

module.exports = priceValidationMiddleware;
