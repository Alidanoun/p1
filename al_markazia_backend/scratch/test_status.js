const workingHoursService = require('../src/services/workingHoursService');

async function test() {
  console.log('--- Testing Status ---');
  try {
    const status = await workingHoursService.getStatus();
    console.log('Status Result:', JSON.stringify(status, null, 2));
  } catch (err) {
    console.error('Test Error:', err);
  }
  process.exit(0);
}

test();
