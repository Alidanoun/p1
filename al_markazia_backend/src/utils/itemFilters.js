/**
 * Tiered Item Identification & Filtering System
 * 
 * Provides centralized logic for item visibility based on the context of the request.
 * Ensures data consistency across Public Menu, Promotional Sections, and Admin Reporting.
 */

const getPublicMenuFilter = () => {
  return {
    isAvailable: true
  };
};

const getFeaturedSectionFilter = () => {
  return {
    isAvailable: true,
    isFeatured: true // ✅ CRITICAL: Only return items explicitly marked as featured
  };
};

const getAdminPanelFilter = (originalFilter = {}) => {
  // Admin sees everything within their query parameters
  return { ...originalFilter };
};

const getAnalyticsFilter = (originalFilter = {}) => {
  // Analytics includes everything (even hidden/archived) for financial accuracy
  return { ...originalFilter };
};

module.exports = {
  getPublicMenuFilter,
  getFeaturedSectionFilter,
  getAdminPanelFilter,
  getAnalyticsFilter
};
