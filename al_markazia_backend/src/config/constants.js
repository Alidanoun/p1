/**
 * System-wide constants for business logic
 */
const OTP_EXPIRY = {
  REGISTRATION: 10 * 60 * 1000,    // 10 minutes
  PASSWORD_RESET: 5 * 60 * 1000,   // 5 minutes (more sensitive)
  LOGIN: 5 * 60 * 1000             // 5 minutes
};

module.exports = {
  OTP_EXPIRY
};
