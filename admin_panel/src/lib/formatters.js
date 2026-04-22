/**
 * Utility to format numbers (Standard English Digits for Professional Look)
 * @param {number|string} number - The number to format
 * @returns {string} - The formatted string with English numerals
 */
export const toArabicNumerals = (number) => {
  if (number === undefined || number === null) return '';
  // Returning standard digits as requested oleh the user
  return number.toString();
};

/**
 * Utility to format currency in JOD with English numerals (en-US style)
 * @param {number} amount - The amount to format
 * @returns {string} - Formatted currency string (e.g., 1,250.00 JOD)
 */
export const formatCurrencyArabic = (amount) => {
  if (amount === undefined || amount === null) return '0.00 JOD';
  
  const num = Number(amount);
  if (!isFinite(num)) return '0.00 JOD';

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  
  return `${formatted} JOD`;
};

/**
 * Simple number formatter for English numerals
 */
export const formatNumberArabic = (number) => {
  if (number === undefined || number === null) return '0';
  return new Intl.NumberFormat('en-US').format(number);
};

/**
 * Modern Date Formatter for Arabic context but English digits
 */
export const formatDateArabic = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/**
 * CRM Status Formatter
 */
export const formatBlacklistStatus = (status) => {
  const map = {
    'ACTIVE': { label: 'محظور دائم', color: 'bg-red-500/10 text-red-500 border-red-500/20' },
    'TEMPORARY': { label: 'حظر مؤقت', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    'EXPIRED': { label: 'حظر منتهي', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
    'NONE': { label: 'نشط', color: 'bg-white/5 text-text-muted border-white/10' }
  };
  return map[status] || map['NONE'];
};

/**
 * Enterprise Risk Indicators
 */
export const getRiskScoreColor = (score) => {
  if (score < 30) return { 
    label: 'Low Risk', 
    color: 'bg-emerald-500/10', 
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/20'
  };
  if (score < 70) return { 
    label: 'Medium Risk', 
    color: 'bg-amber-500/10', 
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/20'
  };
  return { 
    label: 'High Risk', 
    color: 'bg-red-500/10', 
    textColor: 'text-red-500',
    borderColor: 'border-red-500/20'
  };
};

export const formatRiskSeverity = (severity) => {
  const map = {
    'LOW': { label: 'منخفضة', color: 'text-emerald-500', helper: 'مخالفة بسيطة / أول مرة' },
    'MEDIUM': { label: 'متوسطة', color: 'text-amber-500', helper: 'سلوك مزعج متكرر' },
    'HIGH': { label: 'عالية', color: 'text-red-500', helper: 'إساءة استخدام / خطر مباشر' }
  };
  return map[severity] || map['LOW'];
};
