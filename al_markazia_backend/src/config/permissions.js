/**
 * @file permissions.js
 * @description تعريف صلاحيات النظام الدقيقة (Granular Permissions)
 */

const PERMISSIONS = {
  // إدارة الطلبات
  ORDER_VIEW: 'order:view',
  ORDER_VIEW_OWN: 'order:view_own',
  ORDER_UPDATE_STATUS: 'order:update_status',
  ORDER_CANCEL: 'order:cancel',
  ORDER_MANAGE_TIMER: 'order:manage_timer',
  ORDER_PARTIAL_CANCEL: 'order:partial_cancel',

  // الإدارة المالية
  FINANCIAL_VIEW_REPORTS: 'financial:view_reports',
  FINANCIAL_APPROVE_REFUND: 'financial:approve_refund',
  FINANCIAL_MANAGE_LEDGER: 'financial:manage_ledger',

  // إدارة المنتجات
  CATALOG_MANAGE: 'catalog:manage',
  CATALOG_VIEW: 'catalog:view',

  // إدارة المستخدمين والصلاحيات
  USER_MANAGE: 'user:manage',
  USER_VIEW: 'user:view',
  ROLE_ASSIGN: 'role:assign',

  // إعدادات النظام
  SYSTEM_CONFIG_MANAGE: 'system:config_manage',
  SYSTEM_VIEW_LOGS: 'system:view_logs',
  
  // الفروع
  BRANCH_MANAGE: 'branch:manage',
  BRANCH_VIEW: 'branch:view',

  // إدارة علاقات العملاء (CRM)
  CRM_VIEW: 'crm:view',
  CRM_EDIT: 'crm:edit',
  CRM_MANAGE: 'crm:manage'
};

/**
 * مصفوفة الأدوار والحد الأدنى من الصلاحيات الممنوحة لكل دور
 */
const ROLE_PERMISSIONS = {
  'admin': Object.values(PERMISSIONS), // الأدمن يملك كل الصلاحيات
  
  'branch_manager': [
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_UPDATE_STATUS,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.ORDER_MANAGE_TIMER,
    PERMISSIONS.ORDER_PARTIAL_CANCEL,
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.BRANCH_VIEW,
    PERMISSIONS.SYSTEM_VIEW_LOGS,
    PERMISSIONS.CRM_VIEW,
    PERMISSIONS.CRM_EDIT
  ],

  'manager': [
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_UPDATE_STATUS,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.BRANCH_VIEW
  ],

  'staff': [
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_UPDATE_STATUS,
    PERMISSIONS.CATALOG_VIEW
  ],

  'customer': [
    PERMISSIONS.ORDER_VIEW_OWN
  ] // الزبائن يملكون صلاحية رؤية طلباتهم الخاصة فقط
};

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS
};
