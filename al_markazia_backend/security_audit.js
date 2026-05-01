const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const orderService = require('./src/services/orderService');

async function runSecurityAudit() {
  console.log('🛡️ Starting Multi-Branch Security Audit...\n');

  try {
    // 1. Setup Test Branches
    const branchA = await prisma.branch.upsert({
      where: { code: 'BRANCH_A' },
      update: {},
      create: { name: 'Branch A', code: 'BRANCH_A' }
    });
    const branchB = await prisma.branch.upsert({
      where: { code: 'BRANCH_B' },
      update: {},
      create: { name: 'Branch B', code: 'BRANCH_B' }
    });

    // 2. Setup Test Orders
    const orderA = await prisma.order.findFirst({ where: { branchId: branchA.id } }) || await prisma.order.create({
      data: { orderNumber: 'SEC-TEST-A', branchId: branchA.id, customerName: 'A', customerPhone: '111', orderType: 'takeaway', total: 10 }
    });
    const orderB = await prisma.order.findFirst({ where: { branchId: branchB.id } }) || await prisma.order.create({
      data: { orderNumber: 'SEC-TEST-B', branchId: branchB.id, customerName: 'B', customerPhone: '222', orderType: 'takeaway', total: 20 }
    });

    console.log('🧪 TEST 1: Isolation Break (Cross-Branch Read)');
    const managerA = { id: 'some-uuid', role: 'BRANCH_MANAGER', branchId: branchA.id };
    
    try {
      await orderService.getOrderById(orderB.id, managerA);
      console.error('❌ FAIL: Manager A was able to read Order B');
    } catch (err) {
      if (err.message === 'ORDER_FORBIDDEN') {
        console.log('✅ PASS: Manager A blocked from Order B');
      } else {
        console.error('⚠️ UNKNOWN ERROR:', err.message);
      }
    }

    console.log('\n🧪 TEST 2: Admin Edge Case (Global Access)');
    const superAdmin = { id: 'admin-uuid', role: 'super_admin', branchId: null };
    const adminRead = await orderService.getOrderById(orderB.id, superAdmin);
    if (adminRead && adminRead.id === orderB.id.toString()) {
      console.log('✅ PASS: Super Admin accessed Order B');
    } else {
      console.error('❌ FAIL: Super Admin blocked from Order B (Expected ID:', orderB.id.toString(), 'Got:', adminRead?.id, ')');
    }

    console.log('\n🧪 TEST 3: Null branchId Handling (Defaulting Logic)');
    // Currently, our schema allows null branchId. Let's see if our logic handles it.
    // In createOrder, we should ideally default it if missing.
    // Let's check orderService.createOrder
    const newOrder = await orderService.createOrder({
      customerName: 'Guest',
      customerPhone: '999',
      orderType: 'takeaway',
      cartItems: [{ id: 1, quantity: 1 }] // Assuming item 1 exists
      // branchId is NOT passed
    });
    
    if (!newOrder.branchId) {
      console.warn('⚠️ WARNING: New order created with NULL branchId. Need to implement default branch logic in createOrder.');
    } else {
      console.log('✅ PASS: New order assigned to branch:', newOrder.branchId);
    }

  } catch (err) {
    console.error('🔥 Audit Crashed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

runSecurityAudit();
