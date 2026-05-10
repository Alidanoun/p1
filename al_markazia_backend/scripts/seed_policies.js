const prisma = require('../src/lib/prisma');
const logger = require('../src/utils/logger');
const { v4: uuidv4 } = require('uuid');

async function main() {
  const defaults = [
    { key: 'SLA_PREP_TIME', value: { val: 20, unit: 'minutes' }, category: 'SLA', description: 'Standard food preparation time' },
    { key: 'SLA_DELIVERY_TIME', value: { val: 15, unit: 'minutes' }, category: 'SLA', description: 'Standard delivery time from branch to customer' },
    { key: 'DEFAULT_DELIVERY_FEE', value: { val: 1.0, unit: 'JOD' }, category: 'PRICING', description: 'Base delivery fee when no zone is matched' },
    { key: 'FREE_CANCEL_WINDOW_MINUTES', value: { val: 5, unit: 'minutes' }, category: 'CANCELLATION', description: 'Time window for free customer cancellation' },
    { key: 'PEAK_MULTIPLIER', value: { val: 1.0, unit: 'ratio' }, category: 'PRICING', description: 'Price multiplier during peak hours' },
    { key: 'AUTO_CANCEL_TIMEOUT', value: { val: 15, unit: 'minutes' }, category: 'CANCELLATION', description: 'Timeout for administrative cancellation response' }
  ];

  try {
    console.log('🌱 Starting Business Policies Seeding (via RAW SQL)...');
    
    for (const policy of defaults) {
      const valueJson = JSON.stringify(policy.value);
      
      // Use raw SQL to bypass client generation issues
      await prisma.$executeRaw`
        INSERT INTO "BusinessPolicy" ("id", "key", "value", "category", "description", "isActive", "updatedAt")
        VALUES (${uuidv4()}, ${policy.key}, ${JSON.parse(valueJson)}, ${policy.category}, ${policy.description}, true, NOW())
        ON CONFLICT ("key") DO UPDATE SET
          "value" = EXCLUDED."value",
          "category" = EXCLUDED."category",
          "description" = EXCLUDED."description",
          "updatedAt" = NOW();
      `;
    }
    
    console.log('✅ Seeding Completed Successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding Failed:', error.message);
    process.exit(1);
  }
}

main();
