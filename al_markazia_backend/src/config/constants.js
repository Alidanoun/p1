/**
 * System-wide constants for business logic
 */
const OTP_EXPIRY = {
  REGISTRATION: 10 * 60 * 1000,    // 10 minutes
  PASSWORD_RESET: 5 * 60 * 1000,   // 5 minutes (more sensitive)
  LOGIN: 5 * 60 * 1000             // 5 minutes
};

const DEFAULT_TIMEZONE = 'Asia/Amman';

module.exports = {
  OTP_EXPIRY,
  DEFAULT_TIMEZONE
};
