const orderService = require('../src/services/orderService');
const prisma = require('../src/lib/prisma');

const ITEMS = [4, 5, 6]; // Burger, Pizza, Fries
const ZONES = [
  "01772d70-52fc-4984-880f-9e19d542d733",
  "024db6f6-7070-436e-b8bc-cd28a8489451",
  "0254c3a4-72f6-4547-8f10-1919dd68eddd",
  "0b3fcb26-06b6-4ae1-973a-39ed31c89679"
];
const BRANCHES = ["فرع الجاردنز", "فرع المدينة الرياضية", "فرع مكة مول"];
const NAMES = ["أحمد القاسم", "منى التل", "خالد الزعبي", "ريم الكردي", "سامي الناصر", "هالة حداد", "ياسر المصري", "زين القاضي", "عمر الخطيب", "ليلى شومان"];

async function main() {
  console.log('🚀 Starting injection of 20 diverse orders...');

  for (let i = 0; i < 20; i++) {
    const isDelivery = i % 2 === 0;
    const name = NAMES[i % NAMES.length];
    const phone = `079${Math.floor(1000000 + Math.random() * 9000000)}`;
    const branch = BRANCHES[i % BRANCHES.length];
    
    // Random 1-2 items
    const itemCount = Math.random() > 0.5 ? 2 : 1;
    const cartItems = [];
    for (let j = 0; j < itemCount; j++) {
      cartItems.push({
        id: ITEMS[Math.floor(Math.random() * ITEMS.length)],
        quantity: Math.floor(Math.random() * 2) + 1
      });
    }

    const data = {
      customerName: `${name} (${i + 1})`,
      customerPhone: phone,
      orderType: isDelivery ? 'delivery' : 'takeaway',
      paymentMethod: 'cash',
      branch: branch,
      cartItems,
      deliveryZoneId: isDelivery ? ZONES[i % ZONES.length] : null,
      address: isDelivery ? `الشارع ${i + 1}, بجانب المسجد` : null,
      notes: "طلب تجريبي - التحقق من لوحة التحكم"
    };

    try {
      const order = await orderService.createOrder(data);
      console.log(`✅ Created Order ${i + 1}: ${order.orderNumber} - ${data.orderType} - ${data.branch}`);
    } catch (err) {
      console.error(`❌ Failed to create order ${i + 1}:`, err.message);
    }
  }

  console.log('🏁 Injection completed.');
  process.exit(0);
}

main();
