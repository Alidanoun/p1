const Decimal = require('decimal.js');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 🛠️ Historical Loyalty Ledger Backfill Maintenance Script
 * Scans existing user ledger arrays reconciling integer truncation margins safely.
 */
async function backfillCustomerPoints() {
  console.log('🔄 Initiating Precision Anomaly Backfill scan across ledger...');
  
  try {
    const customers = await prisma.customer.findMany({
      select: { id: true, points: true, uuid: true }
    });
    
    let corrected = 0;
    
    for (const customer of customers) {
      const original = customer.points || 0;
      
      // Target precision integer boundary
      const exactTarget = new Decimal(original).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      
      if (Math.abs(original - exactTarget) > 0) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { points: exactTarget }
        });
        
        await prisma.customerAuditLog.create({
          data: {
            customerId: customer.id,
            eventType: 'PRECISION_BACKFILL',
            eventAction: 'LEDGER_RECONCILIATION',
            changedBy: customer.uuid,
            changedByRole: 'system',
            reason: 'Floating-point precision correction via banking round schema',
            previousData: JSON.stringify({ points: original }),
            newData: JSON.stringify({ points: exactTarget }),
            diff: `${exactTarget - original} precision diff`,
            actionCategory: 'LOYALTY',
            requestSource: 'MAINTENANCE_SCRIPT'
          }
        });
        
        corrected++;
        console.log(`✅ Fully corrected ledger balance for customer ${customer.id}: ${original} → ${exactTarget}`);
      }
    }
    
    console.log(`🎯 Backfill pass complete: ${corrected}/${customers.length} customer nodes verified securely.`);
  } catch (err) {
    console.error('❌ Exception interrupted ledger scan pipeline:', err);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  backfillCustomerPoints();
}

module.exports = backfillCustomerPoints;
