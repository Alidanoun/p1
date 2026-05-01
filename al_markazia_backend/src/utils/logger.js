const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

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

// Partial masking for PII (like phone numbers)
const maskPhone = (phone) => {
  if (!phone) return phone;
  const str = String(phone);
  if (str.length <= 4) return '***';
  return str.slice(0, 4) + '***' + str.slice(-2); // Simple mask
};

const { getRequestId } = require('../utils/context');

const SENSITIVE_KEYS = ['otp', 'code', 'password', 'token', 'refreshToken', 'codeHash'];

const sanitizeMetadata = winston.format((info) => {
  if (info.phone) info.phone = maskPhone(info.phone);
  if (info.customerPhone) info.customerPhone = maskPhone(info.customerPhone);
  
  // 🛡️ Redact sensitive keys
  Object.keys(info).forEach(key => {
    if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      info[key] = '[REDACTED]';
    }
  });

  // 🔍 Trace Integration: Automatically attach RequestID if in context
  const requestId = getRequestId();
  if (requestId) {
    info.requestId = requestId;
  }

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

module.exports = logger;
