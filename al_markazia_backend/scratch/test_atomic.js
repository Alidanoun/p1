const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAtomicUpdate() {
  console.log('🧪 Starting Atomic Update Test...');
  
  // 1. Create a "pending" test order
  const order = await prisma.order.create({
    data: {
      orderNumber: 'TEST-' + Date.now(),
      customerName: 'Test User',
      customerPhone: '999999',
      orderType: 'takeaway',
      status: 'pending',
      subtotal: 10,
      total: 10
    }
  });
  console.log(`Created pending order: ${order.id}`);

  // 2. Mock Controller's atomic logic
  const performStatusUpdate = async (id, status) => {
     const where = { id: parseInt(id) };
     if (status === 'preparing') where.status = 'pending';
     
     const affected = await prisma.order.updateMany({
       where,
       data: { status, updatedAt: new Date() }
     });
     return affected.count > 0;
  };

  // 3. Test 1: Successful pending -> preparing
  const res1 = await performStatusUpdate(order.id, 'preparing');
  console.log(`Update to preparing (Success case): ${res1}`);

  // 4. Test 2: Failed preparing -> preparing (since it's no longer pending)
  const res2 = await performStatusUpdate(order.id, 'preparing');
  console.log(`Update to preparing (Fail case - already preparing): ${res2}`);

  // 5. Cleanup
  await prisma.order.delete({ where: { id: order.id } });
  console.log('Test completed.');
  await prisma.$disconnect();
}

testAtomicUpdate();
