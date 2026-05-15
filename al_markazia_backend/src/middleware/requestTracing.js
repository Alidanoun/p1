const crypto = require('crypto');
const { traceContext } = require('../utils/context');
const { trace } = require('@opentelemetry/api');

/**
 * Enterprise Request Tracing Middleware
 * Generates/extracts a unique requestId and stores it in AsyncLocalStorage
 * so it's accessible across the entire call stack without manual passing.
 */
const requestTracing = (req, res, next) => {
  // 🛡️ Resolve Circular Dependency: Import logger inside the function
  const logger = require('../utils/logger');
  const idGenerator = require('../utils/idGenerator');

  // 📡 OpenTelemetry Integration: Link OTel traceId with application correlationId
  const activeSpan = trace.getActiveSpan();
  const otelTraceId = activeSpan?.spanContext()?.traceId;
  
  // Use existing ID or generate a new UUID
  const requestId = req.headers['x-request-id'] || req.query.requestId || idGenerator.generateTraceId();
  const correlationId = req.headers['x-correlation-id'] || req.query.correlationId || otelTraceId || requestId;
  
  const region = process.env.APP_REGION || 'GLOBAL';
  
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Region', region);
  if (otelTraceId) res.setHeader('X-Trace-ID', otelTraceId);

  const startTime = Date.now();
  
  // ⚡ Jittered Sampling Strategy (15% - 25% dynamic range for regular logs)
  const samplingRate = 0.15 + (Math.random() * 0.1);
  const isSampled = Math.random() < samplingRate;
  req.isSampled = isSampled;
  req.requestId = requestId;
  req.correlationId = correlationId;
  req.region = region;

  // 🥇 Trace Lifecycle - Entry
  if (isSampled) {
    logger.info(`> [ReqStart] ${req.method} ${req.url} | Region: ${region}`, { requestId, correlationId, region });
  }

  // 🥈 Trace Lifecycle - Exit (Calculates Response Time)
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`< [ReqEnd] ${req.method} ${req.url} | ${res.statusCode} | ${duration}ms | Region: ${region}`, { 
      requestId, 
      correlationId,
      region,
      statusCode: res.statusCode, 
      duration: `${duration}ms`
    });
  });

  // Run downstream logic within the storage context
  traceContext.run({ requestId, correlationId, region }, () => {
    next();
  });
};

module.exports = {
  requestTracing
};
