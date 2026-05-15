/**
 * Tiered Item Identification & Filtering System
 * 
 * Provides centralized logic for item visibility based on the context of the request.
 * Ensures data consistency across Public Menu, Promotional Sections, and Admin Reporting.
 */

const getPublicMenuFilter = () => {
  return {
    isAvailable: true,
    isDeleted: false
  };
};

const getFeaturedSectionFilter = () => {
  return {
    isAvailable: true,
    isFeatured: true,
    isDeleted: false
  };
};

const getAdminPanelFilter = (originalFilter = {}) => {
  return { 
    ...originalFilter,
    isDeleted: false 
  };
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
