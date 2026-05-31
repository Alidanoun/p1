const prisma = require('./src/lib/prisma');
const logger = require('./src/utils/logger');

async function run() {
  console.log('=== Database Migration: Creating order_number_seq ===');
  try {
    // Run SQL command to create sequence
    const result = await prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 100000;`
    );
    console.log('PostgreSQL Sequence created successfully or already exists. Result:', result);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();
