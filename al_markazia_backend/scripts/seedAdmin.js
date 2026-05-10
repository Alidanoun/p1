const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const logger = require('../src/utils/logger');

/**
 * 🔒 Secure Admin Seeding Script
 * Requirements:
 * - ENCRYPTION_KEY in .env
 * - ADMIN_DEFAULT_PASSWORD in .env (Optional, defaults to safe random if missing)
 */

const prisma = new PrismaClient();

// Utility matching project's encryption logic
const RAW_KEY = process.env.ENCRYPTION_KEY;
if (!RAW_KEY) {
  console.error('❌ CRITICAL: ENCRYPTION_KEY missing in environment.');
  process.exit(1);
}

const ENCRYPTION_KEY = crypto.scryptSync(RAW_KEY, 'salt-pepper', 32);
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function hashBlind(text) {
  if (!text) return text;
  return crypto.createHmac('sha256', ENCRYPTION_KEY)
    .update(String(text))
    .digest('hex');
}

async function seedAdmin() {
  const email = 'admin@almarkazia.com';
  const rawPassword = process.env.ADMIN_DEFAULT_PASSWORD;
  
  if (!rawPassword) {
    console.warn('⚠️  ADMIN_DEFAULT_PASSWORD not set. Using fallback (admin123) - DO NOT USE IN PRODUCTION.');
  }

  const passwordToUse = rawPassword || 'admin123';
  const hashedPassword = await bcrypt.hash(passwordToUse, 12);
  const emailHash = hashBlind(email);

  console.log('🛡️  Starting Secure Admin Seed...');

  const existing = await prisma.user.findUnique({
    where: { emailHash }
  });

  if (existing) {
    console.log('✅ Admin already exists. Synchronizing security settings...');
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: hashedPassword,
        isActive: true,
        failedAttempts: 0,
        lockUntil: null
      }
    });
  } else {
    console.log('➕ Creating new administrative identity...');
    await prisma.user.create({
      data: {
        email: encrypt(email),
        emailHash: emailHash,
        password: hashedPassword,
        name: encrypt('System Administrator'),
        role: 'admin',
        isActive: true
      }
    });
  }

  console.log('✨ Seed complete. Identity secured.');
}

seedAdmin()
  .catch(e => {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
