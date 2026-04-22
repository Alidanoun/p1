const prisma = require('../src/lib/prisma');
async function main() {
  const [items, zones] = await Promise.all([
    prisma.item.findMany({ take: 5, select: { id: true, title: true } }),
    prisma.deliveryZone.findMany({ take: 5, select: { id: true, nameAr: true } })
  ]);
  console.log(JSON.stringify({ items, zones }));
  process.exit(0);
}
main();
