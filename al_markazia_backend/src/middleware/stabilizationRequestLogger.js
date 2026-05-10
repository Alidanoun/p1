const StabilizationLogger = require('../utils/stabilizationLogger');

/**
 * 🕵️ Stabilization Request Logger
 * Injects Phase 0 tracking into the request lifecycle.
 */
const stabilizationRequestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Categorize request for specialized logging
    const url = req.originalUrl;
    
    if (url.includes('/financial') || url.includes('/ledger')) {
      StabilizationLogger.logFinancial(req.method, req.body?.amount || 0, { url, duration });
    }
    
    if (url.includes('/cancel')) {
      StabilizationLogger.logCancellation(req.params.id || req.body.orderId, req.body.reason, req.user || {});
    }
    
    if (url.includes('/approve') || url.includes('/reject')) {
      StabilizationLogger.logApproval(req.params.id || req.body.approvalId, req.method, req.user || {});
    }

    // General request logging for sensitive paths
    StabilizationLogger.logRequest(req, res, { duration });
  });

  next();
};

module.exports = stabilizationRequestLogger;
