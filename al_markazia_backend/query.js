const prisma = require('./src/lib/prisma');
const crypto = require('./src/utils/crypto');

async function test() {
  console.log("--- QUERY RESULT ---");
  const branches = await prisma.branch.findMany({ where: { isDeleted: false } });
  console.log('TOTAL_BRANCHES:', branches.length);
  for (const b of branches) {
    console.log('BRANCH:', b.id, b.code, b.name, b.phone);
    try {
      console.log('DECRYPTED_NAME:', crypto.decrypt(b.name));
    } catch (e) {
      console.log('DECRYPT_NAME_FAILED:', e.message);
    }
    try {
      console.log('DECRYPTED_PHONE:', crypto.decrypt(b.phone));
    } catch (e) {
      console.log('DECRYPT_PHONE_FAILED:', e.message);
    }
  }
  
  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
