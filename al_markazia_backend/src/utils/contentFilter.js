/**
 * 🧹 Content Filter Utility (Phase 1 Governance)
 * Detects profanity, URLs, and phone numbers in reviews.
 */

const BAD_WORDS_AR = [
  'سب', 'شتم', 'لعن', // Simple examples, would be a longer list in prod
  'سيء جدا', 'نصاب', 'حرامي'
];

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const PHONE_REGEX = /(\d{7,15})/g;

const analyzeContent = (text) => {
  if (!text) return { isClean: true, flags: [] };

  const flags = [];
  
  // 1. Check for URLs
  if (URL_REGEX.test(text)) {
    flags.push('CONTAINS_URL');
  }

  // 2. Check for Phone Numbers
  if (PHONE_REGEX.test(text)) {
    flags.push('CONTAINS_PHONE');
  }

  // 3. Check for Profanity (Basic)
  const hasBadWord = BAD_WORDS_AR.some(word => text.includes(word));
  if (hasBadWord) {
    flags.push('PROFANITY_DETECTED');
  }

  return {
    isClean: flags.length === 0,
    flags
  };
};

module.exports = { analyzeContent };
