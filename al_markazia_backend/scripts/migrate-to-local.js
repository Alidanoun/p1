const { PrismaClient } = require('@prisma/client');

const localPrisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://admin:change_me_32chars_minimum@localhost:5432/al_markazia_db' } }
});
const remotePrisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres.lvcmwkqxoutuubjvvuoj:Alidanoun123456%40@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true' } }
});

async function migrate() {
  console.log('🔄 Starting data migration from Supabase to Local...');
  
  // 1. Branches
  const branches = await remotePrisma.branch.findMany();
  if (branches.length > 0) {
    await localPrisma.branch.createMany({ data: branches, skipDuplicates: true });
    console.log(`✅ Migrated ${branches.length} branches`);
  }

  // 2. Users
  const users = await remotePrisma.user.findMany();
  if (users.length > 0) {
    await localPrisma.user.createMany({ data: users, skipDuplicates: true });
    console.log(`✅ Migrated ${users.length} users`);
  }

  // 3. Categories
  const categories = await remotePrisma.category.findMany();
  if (categories.length > 0) {
    await localPrisma.category.createMany({ data: categories, skipDuplicates: true });
    console.log(`✅ Migrated ${categories.length} categories`);
  }

  // 4. Items
  const items = await remotePrisma.item.findMany();
  if (items.length > 0) {
    await localPrisma.item.createMany({ data: items, skipDuplicates: true });
    console.log(`✅ Migrated ${items.length} items`);
  }

  // 5. Item Variants
  const variants = await remotePrisma.itemVariant.findMany();
  if (variants.length > 0) {
    await localPrisma.itemVariant.createMany({ data: variants, skipDuplicates: true });
    console.log(`✅ Migrated ${variants.length} item variants`);
  }

  // 6. Modifier Groups
  const modGroups = await remotePrisma.modifierGroup.findMany();
  if (modGroups.length > 0) {
    await localPrisma.modifierGroup.createMany({ data: modGroups, skipDuplicates: true });
    console.log(`✅ Migrated ${modGroups.length} modifier groups`);
  }

  // 7. Item Modifiers
  const modifiers = await remotePrisma.itemModifier.findMany();
  if (modifiers.length > 0) {
    await localPrisma.itemModifier.createMany({ data: modifiers, skipDuplicates: true });
    console.log(`✅ Migrated ${modifiers.length} item modifiers`);
  }
  
  // 8. Branch Items
  const branchItems = await remotePrisma.branchItem.findMany();
  if (branchItems.length > 0) {
    await localPrisma.branchItem.createMany({ data: branchItems, skipDuplicates: true });
    console.log(`✅ Migrated ${branchItems.length} branch items`);
  }

  console.log('🎉 Migration completed successfully!');
}

migrate()
  .catch(e => {
    console.error('Migration failed:', e);
  })
  .finally(async () => {
    await localPrisma.$disconnect();
    await remotePrisma.$disconnect();
  });
