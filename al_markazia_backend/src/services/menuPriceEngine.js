const { toNumber } = require('../utils/number');

/**
 * 🧮 Menu Price Engine (Phase 1 Logic)
 * Pure function to calculate final price based on variants and modifiers.
 */
class MenuPriceEngine {
  /**
   * Calculates the final price for a menu item selection.
   * @param {Object} item - The Item object from Prisma (with variants and modifiers included)
   * @param {number|null} variantId - Selected variant ID
   * @param {number[]} modifierIds - Array of selected modifier IDs
   * @returns {number} Final calculated price
   */
  static calculateFinalPrice(item, variantId = null, modifierIds = []) {
    let total = toNumber(item.basePrice);

    // 1. Apply Variant Price Difference
    if (variantId) {
      const variant = item.variants.find(v => v.id === variantId);
      if (variant) {
        total += toNumber(variant.priceDiff);
      }
    } else {
      // If no variant selected, check if there's a default one
      const defaultVariant = item.variants.find(v => v.isDefault);
      if (defaultVariant) {
        total += toNumber(defaultVariant.priceDiff);
      }
    }

    // 2. Sum up Modifiers
    if (modifierIds && modifierIds.length > 0) {
      item.modifierGroups.forEach(group => {
        group.modifiers.forEach(mod => {
          if (modifierIds.includes(mod.id)) {
            total += toNumber(mod.price);
          }
        });
      });
    }

    return parseFloat(total.toFixed(2));
  }

  /**
   * Validates if the selected modifiers comply with group rules.
   * @param {Object} item - Item with modifierGroups
   * @param {number[]} selectedModifierIds 
   * @returns {Object} { isValid: boolean, error: string|null }
   */
  static validateSelection(item, selectedModifierIds = []) {
    for (const group of item.modifierGroups) {
      const groupSelections = group.modifiers.filter(m => selectedModifierIds.includes(m.id));
      const count = groupSelections.length;

      if (group.isRequired && count === 0) {
        return { isValid: false, error: `Selection required for group: ${group.groupName}` };
      }

      if (group.minSelection > 0 && count < group.minSelection) {
        return { isValid: false, error: `Minimum ${group.minSelection} items required for group: ${group.groupName}` };
      }

      if (group.maxSelection > 0 && count > group.maxSelection) {
        return { isValid: false, error: `Maximum ${group.maxSelection} items allowed for group: ${group.groupName}` };
      }
    }

    return { isValid: true, error: null };
  }
}

module.exports = MenuPriceEngine;
