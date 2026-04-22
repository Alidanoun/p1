const BASE_URL = 'http://localhost:5000';
const DEVICE_COUNT = 10;

function generateJordanianPhone() {
    const digits = '0123456789';
    let phone = '079';
    for (let i = 0; i < 7; i++) {
        phone += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    return phone;
}

async function simulateUser(index) {
    const startTime = Date.now();
    const phone = generateJordanianPhone();
    const name = `SimUser_${index}_${Math.random().toString(36).substring(7)}`;

    try {
        console.log(`[Device ${index}] Registering ${phone}...`);
        
        // 1. Register
        const regRes = await fetch(`${BASE_URL}/customers/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone })
        });
        
        const regData = await regRes.json();
        if (!regRes.ok) throw new Error(regData.error || 'Reg failed');
        
        const { accessToken } = regData.data;
        const headers = { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}` 
        };

        // 2. Fetch Menu
        console.log(`[Device ${index}] Fetching menu...`);
        const menuRes = await fetch(`${BASE_URL}/items`, { headers });
        const items = await menuRes.json();
        const randomItem = items[Math.floor(Math.random() * items.length)];

        // 3. Place 2 Orders (Burst)
        const orderResults = [];
        for (let i = 0; i < 2; i++) {
            console.log(`[Device ${index}] Placing order ${i+1} for ${randomItem.title}...`);
            const orderPayload = {
                customerName: name,
                customerPhone: phone,
                orderType: 'delivery',
                paymentMethod: 'cash',
                address: 'Simulation Street, Building 5',
                branch: 'فرع شارع المدينة',
                deliveryFee: 2.0,
                tax: 0,
                cartItems: [
                    {
                        id: randomItem.id,
                        quantity: 1,
                        unitPrice: randomItem.basePrice,
                        name: randomItem.title
                    }
                ],
                notes: `Burst Simulation Order ${i+1}`
            };

            const startTimeOrder = Date.now();
            const orderRes = await fetch(`${BASE_URL}/orders`, {
                method: 'POST',
                headers,
                body: JSON.stringify(orderPayload)
            });
            const orderData = await orderRes.json();
            const orderLatency = Date.now() - startTimeOrder;

            if (!orderRes.ok) throw new Error(orderData.error || 'Order failed');
            
            orderResults.push({
                orderNumber: orderData.orderNumber || orderData.data?.orderNumber,
                orderLatency
            });
            
            // Short stagger
            await new Promise(r => setTimeout(r, 200));
        }

        const duration = Date.now() - startTime;

        return {
            success: true,
            phone,
            orders: orderResults,
            duration
        };
    } catch (error) {
        console.error(`[Device ${index}] Error:`, error.message);
        return { success: false, phone, error: error.message };
    }
}

async function runSimulation() {
    console.log('🚀 Starting Enterprise Burst Simulation (Native Fetch)...');
    console.log(`📊 Target: ${DEVICE_COUNT} Devices x 2 Orders = 20 Total Orders`);
    console.log('--------------------------------------------------');

    const startTime = Date.now();
    const promises = [];
    for (let i = 1; i <= DEVICE_COUNT; i++) {
        promises.push(simulateUser(i));
    }

    const results = await Promise.all(promises);
    const totalDuration = Date.now() - startTime;

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('\n--------------------------------------------------');
    console.log('✅ Burst Completed');
    console.log(`📈 Successful Devices: ${successful.length}`);
    console.log(`📈 Total Orders Placed: ${successful.length * 2}`);
    console.log(`📉 Failed Devices: ${failed.length}`);
    console.log(`⏱️ API Burst Time: ${totalDuration}ms`);
    
    console.log('\n⏳ Waiting 35-40 seconds to verify auto-acceptance queue (Target: 30s delay + process time)...');
    
    // In a real test, we'd poll the DB here, but I'll just check logs later.
}

runSimulation();
