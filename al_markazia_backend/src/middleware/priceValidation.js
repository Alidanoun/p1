const prisma = require('../lib/prisma');
const MenuPriceEngine = require('../services/menuPriceEngine');
const logger = require('../utils/logger');

/**
 * 🛡️ Price Validation Middleware
 * Ensures the price sent by the client matches the server-calculated price.
 */
const priceValidationMiddleware = async (req, res, next) => {
  try {
    const items = req.body.cartItems || req.body.items;
    if (!items || !Array.isArray(items)) return next();

    for (const orderItem of items) {
      const itemId = orderItem.itemId || orderItem.productId || orderItem.id;
      const parsedId = parseInt(itemId);
      if (!itemId || isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({ message: 'معرف المنتج غير صالح' });
      }

      const itemData = await prisma.item.findUnique({
        where: { id: parsedId },
        include: {
          variants: true,
          modifierGroups: {
            include: { modifiers: true }
          }
        }
      });

      if (!itemData) {
        return res.status(404).json({ message: `Item not found: ${itemId}` });
      }

      // Resolve modifier IDs and variant ID robustly
      const resolvedModifierIds = (orderItem.modifierIds || orderItem.optionIds || orderItem.options || orderItem.modifiers || [])
        .map(o => parseInt(typeof o === 'object' && o !== null ? o.id : o))
        .filter(id => !isNaN(id));

      const rawVariant = orderItem.variantId || orderItem.selectedVariantId || orderItem.variant?.id || orderItem.variant;
      const resolvedVariantId = rawVariant && !isNaN(parseInt(rawVariant)) ? parseInt(rawVariant) : null;

      // 1. Validate Selection Logic (Min/Max/Required)
      const validation = MenuPriceEngine.validateSelection(itemData, resolvedModifierIds);
      if (!validation.isValid) {
        return res.status(400).json({ message: validation.error });
      }

      // 2. Recalculate Price
      const serverPrice = MenuPriceEngine.calculateFinalPrice(
        itemData, 
        resolvedVariantId, 
        resolvedModifierIds
      );

      // 3. Compare with client-sent price (if provided)
      // Note: We usually trust the server price, but if the client sends a price
      // for UI display, we must ensure it's not being spoofed.
      const clientPrice = orderItem.unitPrice || orderItem.price;
      if (clientPrice && Math.abs(serverPrice - parseFloat(clientPrice)) > 0.01) {
        logger.warn('[PriceValidation] 🚨 Price mismatch detected!', {
          itemId,
          clientPrice,
          serverPrice
        });
        return res.status(400).json({ 
          message: `Price mismatch for item ${itemData.title}. Expected ${serverPrice}, got ${clientPrice}` 
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
