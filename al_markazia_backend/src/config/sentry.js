// src/config/sentry.js
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

/**
 * تهيئة Sentry لرصد الأخطاء التشغيلية، الهجمات الأمنية، وأداء النظام
 * @returns {Object|null} مثيل Sentry أو null إذا لم يتم التهيئة
 */
const initSentry = () => {
  // التحقق من وجود متغير البيئة المطلوب
  if (!process.env.SENTRY_DSN) {
    console.warn('⚠️  SENTRY_DSN not found in environment variables - Error monitoring disabled');
    console.warn('💡  Add SENTRY_DSN to your .env file to enable Sentry');
    return null;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: `al-markazia@${process.env.npm_package_version || 'dev'}`,
    
    // 🛡️ Requested properties preserved exactly
    attachStacktrace: true,
    maxBreadcrumbs: 50,

    // معدل أخذ العينات للتتبع (أقل في الإنتاج لتقليل التكلفة)
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // معدل أخذ العينات لملفات الأداء (Profiling)
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // التكاملات المفعلة
    integrations: [
      nodeProfilingIntegration(),
    ],
    
    // تجاهل الأخطاء التافهة التي لا تستدعي التنبيه
    ignoreErrors: [
      'ECONNREFUSED',           // أخطاء اتصال خارجية مؤقتة
      'ECONNRESET',             // إعادة تعيين الاتصال
      'TokenExpiredError',      // يتم التعامل معها محلياً في TokenService
      'JsonWebTokenError',      // أخطاء توكن غير صالحة (متوقعة)
      'UNAUTHORIZED',           // محاولات وصول مرفوضة متوقعة
      'FORBIDDEN',              // صلاحيات غير كافية
      'HTTP_400',               // طلبات غير صالحة من العميل
      'HTTP_404',               // موارد غير موجودة
    ],
    
    // معالجة الحدث قبل الإرسال لإضافة سياق أمني
    beforeSend(event, hint) {
      // تحديد ما إذا كان الحدث مرتبطاً بأمان
      const message = event.message || '';
      const exception = hint?.originalException;
      
      const isSecurityIssue = 
        message.toLowerCase().includes('auth') ||
        message.toLowerCase().includes('token') ||
        message.toLowerCase().includes('otp') ||
        message.toLowerCase().includes('password') ||
        message.toLowerCase().includes('session') ||
        exception?.securityCritical === true ||
        exception?.code === 'SECURITY_VIOLATION';

      if (isSecurityIssue) {
        // إضافة وسوم للتمييز في لوحة Sentry
        event.tags = {
          ...event.tags,
          security_alert: 'true',
          severity: event.tags?.severity || 'critical',
          module: event.tags?.module || 'auth'
        };
        
        // إزالة البيانات الحساسة من السياق تلقائياً
        if (event.extra?.password) delete event.extra.password;
        if (event.extra?.token) delete event.extra.token;
        if (event.user?.email && process.env.NODE_ENV === 'production') {
          // تشويه البريد في الإنتاج لحماية الخصوصية
          event.user.email = event.user.email.replace(/(.{2}).+(@.+)/, '$1***$2');
        }
      }
      
      return event;
    }
  });

  console.log(`🛡️  Sentry initialized - Environment: ${process.env.NODE_ENV || 'development'}`);
  return Sentry;
};

// دالة مساعدة لتسجيل الأخطاء الأمنية بشكل موحد
const captureSecurityEvent = (error, context = {}) => {
  if (!Sentry) return;
  
  Sentry.captureException(error, {
    tags: {
      module: context.module || 'unknown',
      attack_type: context.attackType || 'unknown',
      severity: context.severity || 'high',
      ...context.tags
    },
    extra: {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      ...context.extra
    },
    level: context.severity === 'critical' ? 'fatal' : 'error'
  });
};

module.exports = { 
  initSentry, 
  Sentry, 
  captureSecurityEvent 
};
