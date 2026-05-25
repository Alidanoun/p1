const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedBranchItems() {
  console.log('Starting seed...');
  
  // التشخيص قبل البدء
  const allItems = await prisma.item.findMany();
  const branchItemsCount = await prisma.branchItem.count();
  const branches = await prisma.branch.findMany({ where: { isActive: true } });
  
  console.log(`Total items: ${allItems.length}`);
  console.log(`Total active branches: ${branches.length}`);
  console.log(`Current BranchItem records: ${branchItemsCount}`);
  
  const itemsWithoutBranchItems = await prisma.$queryRaw`
    SELECT i.id, i.title, i."isGlobal"
    FROM "Item" i
    WHERE NOT EXISTS (
      SELECT 1 FROM "BranchItem" bi WHERE bi."itemId" = i.id
    )
  `;
  
  console.log(`Items without ANY BranchItem relation: ${itemsWithoutBranchItems.length}`);

  // الربط الفعلي للأصناف العالمية
  const globalItems = await prisma.item.findMany({ where: { isGlobal: true, isDeleted: false } });
  let createdCount = 0;

  for (const branch of branches) {
    for (const item of globalItems) {
      const existing = await prisma.branchItem.findUnique({
        where: { branchId_itemId: { branchId: branch.id, itemId: item.id } }
      });
      
      if (!existing) {
        await prisma.branchItem.create({
          data: {
            branchId: branch.id,
            itemId: item.id,
            isAvailable: true,
            stockCount: -1
          }
        });
        createdCount++;
      }
    }
  }
  
  console.log(`✅ Successfully linked ${createdCount} new BranchItem records.`);
  await prisma.$disconnect();
}

seedBranchItems().catch(e => {
  console.error(e);
  process.exit(1);
});
