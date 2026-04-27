const EmailService = require('../src/services/emailService');
require('dotenv').config();

async function testEmail() {
  console.log('Testing Email Service...');
  const success = await EmailService.sendOtp('adanoun163@gmail.com', '123456');
  if (success) {
    console.log('✅ Test Email SENT. Check your inbox/spam.');
  } else {
    console.error('❌ Test Email FAILED. Check logs.');
  }
}

testEmail();
