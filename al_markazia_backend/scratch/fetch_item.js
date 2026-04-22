const prisma = require('../src/lib/prisma');
async function main() {
  try {
    const item = await prisma.item.findFirst();
    console.log(JSON.stringify(item));
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
main();
