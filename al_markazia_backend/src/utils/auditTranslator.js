/**
 * 🌍 Audit Action Translator
 * Purpose: Converts technical action constants into human-friendly Arabic descriptions.
 */

const ACTION_MAP = {
  // Auth Actions
  'LOGIN_SUCCESS': 'تسجيل دخول ناجح',
  'LOGIN_FAIL': 'محاولة دخول فاشلة',
  'LOGOUT': 'تسجيل خروج',
  'REFRESH_TOKEN': 'تحديث جلسة العمل',
  'TOKEN_REFRESH': 'تجديد تصريح الدخول',
  'SOCKET_DISCONNECT': 'انقطاع الاتصال الفوري',
  'SOCKET_CONNECT': 'اتصال فوري جديد',

  
  // Dashboard & Audit
  'GET_API_V1_ADMIN_AUDIT_LOGS': 'استعراض سجل التدقيق والمراقبة',
  'GET__API_V1_ADMIN_AUDIT_LOGS': 'استعراض سجل التدقيق والمراقبة',
  'GET_API_V1_ADMIN_AUDIT_STATS': 'تحديث إحصائيات المراقبة',
  'GET__API_V1_ADMIN_AUDIT_STATS': 'تحديث إحصائيات المراقبة',
  'GET_API_V1_DASHBOARD_METRICS': 'تحديث أرقام لوحة التحكم',
  'GET__API_V1_DASHBOARD_METRICS': 'تحديث أرقام لوحة التحكم',
  'BRANCH_SWITCH': 'تبديل الفرع الحالي',
  
  // Orders
  'ORDER_CREATE': 'إنشاء طلب جديد',
  'ORDER_STATUS_UPDATE': 'تغيير حالة الطلب',
  'ORDER_CANCEL': 'إلغاء طلب',
  'ORDER_REFUND': 'إرجاع مبلغ الطلب',
  
  // Financial
  'FINANCIAL_APPROVAL_REQUEST': 'طلب اعتماد مالي',
  'FINANCIAL_APPROVAL_ACTION': 'معالجة طلب اعتماد مالي',
  'WALLET_CREDIT': 'شحن محفظة عميل',
  
  // Menu & Settings
  'ITEM_UPDATE': 'تعديل بيانات منتج',
  'CATEGORY_UPDATE': 'تعديل تصنيف المنتجات',
  'SETTINGS_UPDATE': 'تغيير إعدادات النظام العام',
  
  // Security
  'SECURITY_BREACH_ALERT': '🚨 تنبيه أمني خطير',
  'FINGERPRINT_MISMATCH': 'تحذير: محاولة دخول من جهاز غير معروف'
};

const CATEGORY_MAP = {
  'SECURITY': 'الأمن والحماية',
  'FINANCIAL': 'العمليات المالية',
  'OPERATIONAL': 'العمليات الإدارية',
  'SYSTEM': 'النظام الآلي'
};

/**
 * Translates a technical action string to friendly Arabic
 */
const translateAction = (action) => {
  return ACTION_MAP[action] || action; // Fallback to raw if not mapped
};

/**
 * Gets a friendly category based on action or metadata
 */
const getFriendlyCategory = (log) => {
  if (log.severity === 'CRITICAL' || log.action.includes('SECURITY')) return CATEGORY_MAP.SECURITY;
  if (log.entityType === 'FinancialLedger' || log.action.includes('WALLET')) return CATEGORY_MAP.FINANCIAL;
  if (log.entityType === 'Order' || log.entityType === 'Item') return CATEGORY_MAP.OPERATIONAL;
  return CATEGORY_MAP.SYSTEM;
};

module.exports = {
  translateAction,
  getFriendlyCategory
};
