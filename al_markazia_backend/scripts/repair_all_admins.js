/**
 * 🔧 Repair All Admin Accounts
 * Re-encrypts user data with new encryption keys and sets unified password.
 * 
 * Usage: node scripts/repair_all_admins.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Import crypto utilities (uses new ENCRYPTION_KEY from .env)
const { encrypt, hashBlind, decrypt } = require('../src/utils/crypto');

const prisma = new PrismaClient();

const ACCOUNTS = [
  {
    email: 'admin@almarkazia.com',
    name: 'المدير العام',
    role: 'ADMIN',
    branchId: null
  },
  {
    email: 'khalda@almarkazia.com',
    name: 'مدير فرع الخالدة',
    role: 'BRANCH_MANAGER',
    branchId: null // will be resolved
  },
  {
    email: 'madina@almarkazia.com',
    name: 'مدير فرع المدينة',
    role: 'BRANCH_MANAGER',
    branchId: null // will be resolved
  }
];

const UNIFIED_PASSWORD = 'Admin123';

async function getActiveBranches() {
  const branches = await prisma.branch.findMany({
    where: { isActive: true, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    take: 2
  });
  return branches;
}

async function repairAccounts() {
  console.log('🔧 Starting Admin Account Repair...\n');
  console.log(`🔑 Encryption Key Length: ${process.env.ENCRYPTION_KEY?.length || 0} chars`);
  console.log(`🔐 Password to set: ${UNIFIED_PASSWORD}\n`);

  // Test encryption
  try {
    const test = encrypt('test');
    console.log(`✅ Encryption test passed: ${test.substring(0, 20)}...`);
  } catch (e) {
    console.error('❌ ENCRYPTION FAILED:', e.message);
    process.exit(1);
  }

  // Get active branches for branch managers
  const branches = await getActiveBranches();
  console.log(`📋 Found ${branches.length} active branches\n`);

  if (branches.length >= 1) ACCOUNTS[1].branchId = branches[0].id;
  if (branches.length >= 2) ACCOUNTS[2].branchId = branches[1].id;

  const hashedPassword = await bcrypt.hash(UNIFIED_PASSWORD, 12);

  for (const account of ACCOUNTS) {
    console.log(`\n📝 Processing: ${account.email} (${account.role})`);

    const encryptedEmail = encrypt(account.email);
    const emailHash = hashBlind(account.email);
    const encryptedName = encrypt(account.name);

    // Check if user exists by emailHash
    let existing = await prisma.user.findUnique({
      where: { emailHash }
    });

    if (existing) {
      console.log(`   Found existing user (ID: ${existing.id})`);

      // Check if name/email are encrypted with OLD key (decryption fails or returns garbage)
      let needsReEncrypt = false;
      try {
        const decryptedName = decrypt(existing.name);
        const decryptedEmail = decrypt(existing.email);
        // If decryption succeeds but doesn't match expected, it's old encryption
        if (decryptedName !== account.name || !decryptedEmail.includes('@')) {
          needsReEncrypt = true;
          console.log(`   ⚠️  Data encrypted with OLD key — re-encrypting...`);
        }
      } catch (e) {
        needsReEncrypt = true;
        console.log(`   ⚠️  Decryption failed — re-encrypting...`);
      }

      // Check if email is stored as plain text
      if (existing.email === account.email) {
        needsReEncrypt = true;
        console.log(`   ⚠️  Email stored as plain text — encrypting...`);
      }

      if (needsReEncrypt || existing.password !== hashedPassword) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            email: encryptedEmail,
            emailHash: emailHash,
            name: encryptedName,
            password: hashedPassword,
            role: account.role,
            branchId: account.branchId,
            isActive: true,
            failedAttempts: 0,
            lockUntil: null,
            authVersion: { increment: 1 }
          }
        });
        console.log(`   ✅ Updated: ${account.email}`);
      } else {
        console.log(`   ✅ Already up to date: ${account.email}`);
      }
    } else {
      // Create new user
      try {
        const newUser = await prisma.user.create({
          data: {
            email: encryptedEmail,
            emailHash: emailHash,
            name: encryptedName,
            password: hashedPassword,
            role: account.role,
            branchId: account.branchId,
            isActive: true,
            failedAttempts: 0,
            lockUntil: null
          }
        });
        console.log(`   ✅ Created new user (ID: ${newUser.id}): ${account.email}`);
      } catch (createErr) {
        if (createErr.code === 'P2002') {
          console.log(`   ⚠️  User already exists (unique constraint): ${account.email}`);
        } else {
          console.error(`   ❌ Failed to create: ${createErr.message}`);
        }
      }
    }

    // Clean up any plain-text duplicates
    const allUsers = await prisma.user.findMany();
    for (const u of allUsers) {
      if (u.email === account.email && u.email !== encryptedEmail) {
        console.log(`   🗑️  Deleting plain-text duplicate: ${u.email} (ID: ${u.id})`);
        await prisma.user.delete({ where: { id: u.id } });
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Admin Account Repair Complete!\n');
  console.log('📋 Login Credentials:');
  console.log('   Email: admin@almarkazia.com  | Password: Admin123  | Role: Admin');
  console.log('   Email: khalda@almarkazia.com | Password: Admin123  | Role: Branch Manager');
  console.log('   Email: madina@almarkazia.com | Password: Admin123  | Role: Branch Manager');
  console.log('='.repeat(50));
}

repairAccounts().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
