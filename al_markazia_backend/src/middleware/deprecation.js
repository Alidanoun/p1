/**
 * ⚠️ Deprecation Middleware
 * Standardized HTTP headers to notify clients about legacy/deprecated endpoints.
 * Follows IETF draft standards for API lifecycle management.
 */
const deprecationHandler = (options = {}) => {
  return (req, res, next) => {
    // 1. Deprecation Header (Boolean or Date)
    // Indicates the endpoint is deprecated.
    res.setHeader('Deprecation', options.date || 'true');
    
    // 2. Link Header
    // Points to the new version or documentation about the change.
    if (options.alternative) {
      res.setHeader('Link', `<${options.alternative}>; rel="alternate"`);
    }

    // 3. Warning Header (299 - Miscellaneous persistent warning)
    // Human-readable warning for developers.
    const message = `The endpoint ${req.originalUrl} is deprecated. Please migrate to ${options.alternative || 'the latest API version (/api/v1)'}.`;
    res.setHeader('Warning', `299 - "${message}"`);

    next();
  };
};

module.exports = deprecationHandler;
