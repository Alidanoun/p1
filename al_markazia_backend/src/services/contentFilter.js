// src/services/contentFilter.js

/**
 * 🛡️ Content Filter Service
 * Responsible for sanitizing and validating user-generated content.
 */

const BANNED_WORDS_AR = [
  // List of banned words (placeholder for demonstration)
  "زبالة", "مقرف"
];

const BANNED_PATTERNS = [
  /https?:\/\//i,                         // Links
  /<[^>]+>/,                              // HTML tags (XSS Prevention)
  /\b\d{10,}\b/,                          // Long digits (Phone numbers, accounts)
  /([a-z0-9._-]+)@([a-z0-9.-]+)/i,       // Emails
];

/**
 * Clean and normalize text
 */
function sanitizeComment(text) {
  if (!text || typeof text !== 'string') return null;
  
  // 1. Trim & normalize whitespace
  let clean = text.trim().replace(/\s+/g, ' ');
  
  // 2. Length check (Max 500 characters as per schema)
  if (clean.length === 0) return null;
  if (clean.length > 500) clean = clean.substring(0, 500);
  
  return clean;
}

/**
 * Verify if the content is safe for publishing
 */
function isContentSafe(text) {
  if (!text) return { safe: true };
  
  const lower = text.toLowerCase();
  
  // 1. Check for Banned Words
  for (const word of BANNED_WORDS_AR) {
    if (lower.includes(word.toLowerCase())) {
      return { safe: false, reason: 'BANNED_WORD' };
    }
  }
  
  // 2. Check for Suspicious Patterns (HTML, Links, etc.)
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: 'SUSPICIOUS_PATTERN' };
    }
  }
  
  return { safe: true };
}

module.exports = { 
  sanitizeComment, 
  isContentSafe 
};
