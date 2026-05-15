/**
 * 🎯 Centralized Menu Resolver (Phase 3)
 * The Single Source of Truth for resolving availability and visibility
 * across Branches, Items, and Variants.
 */

/**
 * Resolves the final availability of a variant for a specific branch context.
 * 
 * Hierarchy (Deterministic):
 * 1. BranchItem (Hard Block) -> If item is disabled for branch, everything is disabled.
 * 2. Item Constraint (Hard Block) -> If item is disabled globally, everything is disabled.
 * 3. BranchVariant Override -> Highest priority toggle.
 * 4. ItemVariant Default -> Fallback if no override exists.
 * 
 * @param {Object} item - The parent Item object (must include isAvailable)
 * @param {Object} variant - The ItemVariant object (must include isAvailable)
 * @param {Object|null} branchItem - The BranchItem record for this branch (if exists)
 * @param {Object|null} branchVariant - The BranchVariant override for this branch (if exists)
 * @returns {Boolean} Resolved availability
 */
const resolveVariantAvailability = (item, variant, branchItem = null, branchVariant = null) => {
  // 1. Branch-Level Item Visibility (Visibility Shortcut)
  if (branchItem && branchItem.isAvailable === false) {
    return false;
  }

  // 2. Global Item Constraints
  if (item.isAvailable === false) {
    return false;
  }

  // 3. Branch-Specific Variant Override (Operational State)
  if (branchVariant && branchVariant.isAvailable !== undefined) {
    return branchVariant.isAvailable;
  }

  // 4. Global Variant Default
  return variant.isAvailable;
};

/**
 * Resolves the final availability of an Item for a specific branch.
 * 
 * @param {Object} item - Global Item object
 * @param {Object|null} branchItem - Branch-specific override
 * @returns {Boolean}
 */
const resolveItemAvailability = (item, branchItem = null) => {
  if (branchItem && branchItem.isAvailable !== undefined) {
    return branchItem.isAvailable;
  }
  return item.isAvailable;
};

module.exports = {
  resolveVariantAvailability,
  resolveItemAvailability
};
