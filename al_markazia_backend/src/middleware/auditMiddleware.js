const auditService = require('../services/auditService');
const logger = require('../utils/logger');

/**
 * 🕵️ Audit Middleware
 * Automatically logs sensitive operations to the SystemAuditLog.
 */
const auditMiddleware = async (req, res, next) => {
  const sensitiveRoutes = [
    '/branch/switch',
    '/admin',
    '/settings',
    '/financial'
  ];

  const isSensitive = sensitiveRoutes.some(route => req.originalUrl.includes(route));

  if (isSensitive) {
    // Capture the original send to inspect response if needed
    const originalSend = res.send;
    let responseBody = '';

    res.send = function (data) {
      responseBody = data;
      return originalSend.call(this, data);
    };

    res.on('finish', async () => {
      // Only log if user is authenticated (middleware order matters!)
      if (req.user) {
        try {
          await auditService.log({
            action: `${req.method}_${req.originalUrl.split('?')[0].toUpperCase().replace(/\//g, '_')}`,
            userId: req.user.id,
            userRole: req.user.role,
            status: res.statusCode < 400 ? 'SUCCESS' : 'FAILED',
            severity: res.statusCode >= 400 ? 'WARN' : 'INFO',
            metadata: {
              method: req.method,
              path: req.originalUrl,
              statusCode: res.statusCode,
              query: req.query,
              // Avoid logging large bodies or sensitive data like passwords
              hasBody: !!req.body && Object.keys(req.body).length > 0
            },
            req
          });
        } catch (err) {
          logger.error('[AuditMiddleware] Failed to log sensitive request', { error: err.message });
        }
      }
    });
  }

  next();
};

module.exports = auditMiddleware;
