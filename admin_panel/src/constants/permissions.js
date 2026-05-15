/**
 * 🔐 Global Permission Matrix
 * Maps Roles to specific functional capabilities across the platform.
 * Backend remains the authority; this layer controls UX visibility and navigation.
 */
export const ROLES = {
  ADMIN: 'ADMIN',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  STAFF: 'STAFF',
  KITCHEN: 'KITCHEN',
  DRIVER: 'DRIVER'
};

export const PERMISSIONS = {
  // 📈 Analytics & Finance
  VIEW_GLOBAL_STATS: [ROLES.ADMIN],
  VIEW_BRANCH_STATS: [ROLES.ADMIN, ROLES.BRANCH_MANAGER],
  VIEW_REPORTS: [ROLES.ADMIN],
  
  // 🛒 Order Management
  MANAGE_ORDERS: [ROLES.ADMIN, ROLES.BRANCH_MANAGER, ROLES.STAFF],
  CANCEL_ORDER: [ROLES.ADMIN, ROLES.BRANCH_MANAGER],
  APPROVE_REFUND: [ROLES.ADMIN],
  
  // 🏢 Branch Management
  MANAGE_BRANCHES: [ROLES.ADMIN],
  TOGGLE_RESTAURANT_STATUS: [ROLES.ADMIN, ROLES.BRANCH_MANAGER],
  EMERGENCY_CLOSE: [ROLES.ADMIN],
  
  // 📋 Menu & Content
  MANAGE_GLOBAL_MENU: [ROLES.ADMIN],
  MANAGE_BRANCH_MENU: [ROLES.ADMIN, ROLES.BRANCH_MANAGER],
  
  // 🛡️ Security & Audit
  VIEW_AUDIT_LOGS: [ROLES.ADMIN],
  MANAGE_USERS: [ROLES.ADMIN]
};

/**
 * 🕵️ Permission Resolver
 */
export const hasPermission = (userRole, permission) => {
  if (!userRole || !permission) return false;
  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) return false;
  
  return allowedRoles.includes(userRole.toUpperCase());
};
