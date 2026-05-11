const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const { getRequestId, getCorrelationId } = require('./context');

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Log Levels: error -> warn -> info -> http -> debug
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Security level is essentially a custom label, but we will route any
// specific tags to the security transport using a custom format filter.
// We will also use standard levels.

const env = process.env.NODE_ENV || 'development';
const isDevelopment = env !== 'production';

winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
});

const SENSITIVE_KEYS = [
  'otp', 'code', 'password', 'token', 'refreshToken', 'codeHash', 
  'jwt', 'secret', 'authorization', 'signature', 'payload', 
  'email', 'phone', 'customerPhone', 'creditCard', 'cvv'
];

/**
 * 🛡️ Deep Redactor
 * Recursively scans objects and arrays to mask sensitive data at any depth.
 * [IDEMPOTENT]: Preserves non-object values and standard Winston symbols.
 */
const deepRedact = (obj) => {
  if (!obj || typeof obj !== 'object' || obj instanceof Date) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => deepRedact(item));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // 1. Check for sensitive keys
    if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk.toLowerCase()))) {
      redacted[key] = '[REDACTED]';
    } 
    // 2. Recursive redaction for nested objects
    else if (typeof value === 'object' && value !== null) {
      redacted[key] = deepRedact(value);
    } 
    // 3. Copy safe values
    else {
      redacted[key] = value;
    }
  }
  return redacted;
};

const sanitizeMetadata = winston.format((info) => {
  // 🛡️ Apply Deep Redaction across all log data
  const cleanInfo = deepRedact(info);
  
  // Re-assign to info object (Preserving Winston's internal symbols)
  Object.assign(info, cleanInfo);

  // 🔍 Trace Integration: Automatically attach Trace IDs if in context
  const requestId = getRequestId();
  const correlationId = getCorrelationId();
  if (requestId) info.requestId = requestId;
  if (correlationId) info.correlationId = correlationId;

  // Attach standard service tag
  info.service = 'al-markazia-backend';
  return info;
});

const defaultJsonFormat = winston.format.combine(
  sanitizeMetadata(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// TRANSPORT 2: Combined
const combinedTransport = new winston.transports.DailyRotateFile({
  filename: path.join(__dirname, '../../logs/combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: defaultJsonFormat,
});

// TRANSPORT 3: Error
const errorTransport = new winston.transports.DailyRotateFile({
  level: 'error',
  filename: path.join(__dirname, '../../logs/errors-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '30d',
  format: defaultJsonFormat,
});

// TRANSPORT 4: Security (Auth & rate limit events)
// Filter specifically for metadata containing isSecurityEvent = true
const securityFilter = winston.format((info) => {
  return info.isSecurityEvent ? info : false;
});

const securityTransport = new winston.transports.DailyRotateFile({
  filename: path.join(__dirname, '../../logs/security-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxFiles: '60d', // No max size strictly requested, leaving default handling
  format: winston.format.combine(
    securityFilter(),
    defaultJsonFormat
  ),
});

// TRANSPORT 1: Console
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      (info) => `[${info.timestamp}] ${info.level}: ${info.message} ${
        Object.keys(info).filter(k => !['timestamp', 'level', 'message', 'service', 'Symbol(level)', 'Symbol(message)', 'Symbol(splat)'].includes(k)).length > 0
          ? JSON.stringify(info, (key, value) => ['timestamp', 'level', 'message', 'service'].includes(key) ? undefined : value)
          : ''
      }`
    )
  ),
});

const transportsList = [
  combinedTransport,
  errorTransport,
  securityTransport
];

if (isDevelopment) {
  transportsList.push(consoleTransport);
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'http'),
  levels,
  transports: transportsList,
  exceptionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    })
  ],
  rejectionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    })
  ]
});

// Custom helper method for security events
logger.security = (message, meta = {}) => {
  logger.info(message, { ...meta, isSecurityEvent: true });
};

// 🏛️ Custom helper for Legacy Migration tracking
logger.deprecate = (message, meta = {}) => {
  logger.warn(`DEPRECATED: ${message}`, { ...meta, isDeprecationEvent: true });
};

// 💰 Specialized Financial Action Logging
logger.financial = (message, meta = {}) => {
  logger.info(`[FINANCIAL] ${message}`, { ...meta, category: 'FINANCIAL', timestamp: new Date().toISOString() });
};

// 🛑 Specialized Cancellation Tracking
logger.cancellation = (message, meta = {}) => {
  logger.warn(`[CANCELLATION] ${message}`, { ...meta, category: 'CANCELLATION', timestamp: new Date().toISOString() });
};

// ✅ Specialized Approval Auditing
logger.approval = (message, meta = {}) => {
  logger.info(`[APPROVAL] ${message}`, { ...meta, category: 'APPROVAL', timestamp: new Date().toISOString() });
};

// ⚡ Specialized Socket Event Monitoring
logger.socket = (message, meta = {}) => {
  logger.debug(`[SOCKET] ${message}`, { ...meta, category: 'SOCKET', timestamp: new Date().toISOString() });
};

// 🧠 Specialized Causal Reasoning Logger
// يهدف لشرح "لماذا" تم اتخاذ قرار معين (خاصة في حالات التصحيح التلقائي)
logger.reasoning = (message, meta = {}) => {
  logger.info(`[REASONING] ${message}`, { ...meta, category: 'CAUSAL_REASONING', timestamp: new Date().toISOString() });
};

/**
 * 🛡️ Enhanced Error Logger
 * يضمن تسجيل الخطأ مع كامل السياق التقني
 */
logger.logError = (context, error, metadata = {}) => {
  const errorDetails = {
    context: context, // مكان حدوث الخطأ (مثلاً: CacheService.subscribe)
    message: error.message,
    stack: error.stack,
    ...metadata // أي بيانات إضافية مثل userId أو orderId
  };

  logger.error(`[${context}] ${error.message}`, errorDetails);
};

module.exports = logger;
