const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file');

/**
 * 🧾 Financial Audit Logger (The Ledger)
 * RESPONSIBILITY: Append-only immutable log of all monetary transitions.
 */
const auditLogFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const financialLogger = winston.createLogger({
  level: 'info',
  format: auditLogFormat,
  transports: [
    new winston.transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/financial-audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '365d', // Keep audit logs for 1 year
      zippedArchive: true,
      // 🛡️ Immutable lock: This transport only handles financial events
    })
  ]
});

/**
 * Logs a financial transition with full context.
 */
const logFinancialEvent = (auditData) => {
  financialLogger.info('FINANCIAL_TRANSITION', auditData);
  
  // Also log to console in dev for visibility
  if (process.env.NODE_ENV !== 'production') {
    console.log(`💰 [FINANCE] ${auditData.event} | Order: ${auditData.order_id} | Delta: ${auditData.delta}`);
  }
};

module.exports = { logFinancialEvent };
