/**
 * 📊 Frontend Logger Service
 * Centralizes UI logging and facilitates future integration with Sentry/LogRocket.
 */
const logger = {
  debug: (message, ...args) => {
    if (import.meta.env.MODE === 'development') {
      console.log(`%c[DEBUG] %c${message}`, 'color: #9e9e9e; font-weight: bold', 'color: inherit', ...args);
    }
  },

  info: (message, ...args) => {
    console.log(`%c[INFO] %c${message}`, 'color: #2196f3; font-weight: bold', 'color: inherit', ...args);
  },

  warn: (message, ...args) => {
    console.warn(`%c[WARN] %c${message}`, 'color: #ff9800; font-weight: bold', 'color: inherit', ...args);
    // Integration: window.Sentry?.captureMessage(message, { level: 'warning', extra: args });
  },

  error: (message, error = null, ...args) => {
    console.error(`%c[ERROR] %c${message}`, 'color: #f44336; font-weight: bold', 'color: inherit', error, ...args);
    // Integration: window.Sentry?.captureException(error || new Error(message), { extra: args });
  }
};

export default logger;
