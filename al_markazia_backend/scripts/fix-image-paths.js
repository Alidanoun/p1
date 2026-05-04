const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixPaths() {
  console.log('🔍 Checking for incorrect image paths...');
  
  const items = await prisma.item.findMany({
    where: {
      image: { contains: '/uploads/items/' }
    }
  });

  console.log(`Found ${items.length} items to fix.`);

  for (const item of items) {
    const newPath = item.image.replace('/uploads/items/', '/uploads/');
    await prisma.item.update({
      where: { id: item.id },
      data: { image: newPath }
    });
    console.log(`✅ Fixed item ${item.id}: ${newPath}`);
  }

  console.log('✨ All paths fixed successfully.');
  await prisma.$disconnect();
}

fixPaths().catch(err => {
  console.error(err);
  process.exit(1);
});
