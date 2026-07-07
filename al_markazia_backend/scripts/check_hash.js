require('dotenv').config(); // Load fallback dotenv if any
const { hashBlind } = require('../src/utils/crypto');

console.log('--- Email Hash Verification ---');
const email = 'admin@almarkazia.com';
try {
  const currentHash = hashBlind(email);
  console.log(`Email: ${email}`);
  console.log(`Current Key Blind Hash: ${currentHash}`);
} catch (e) {
  console.error('Error computing hash:', e.message);
}
