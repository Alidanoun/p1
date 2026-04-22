const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const zones = [
  { nameAr: 'البركة', fee: 2.00, sortOrder: 1 },
  { nameAr: 'أم السماق', fee: 2.00, sortOrder: 2 },
  { nameAr: 'تلاع العلي', fee: 2.00, sortOrder: 3 },
  { nameAr: 'شارع الجاردنز', fee: 2.00, sortOrder: 4 },
  { nameAr: 'شارع المدينة', fee: 2.00, sortOrder: 5 },
  { nameAr: 'الجندويل', fee: 2.50, sortOrder: 6 },
  { nameAr: 'المدينة الطبية', fee: 2.50, sortOrder: 7 },
  { nameAr: 'ضاحية الأمير راشد', fee: 2.50, sortOrder: 8 },
  { nameAr: 'الرابية', fee: 2.50, sortOrder: 9 },
  { nameAr: 'ضاحية الروضة', fee: 2.50, sortOrder: 10 },
  { nameAr: 'ضاحية الرشيد', fee: 2.50, sortOrder: 11 },
  { nameAr: 'الروابي', fee: 2.50, sortOrder: 12 },
  { nameAr: 'خلدا', fee: 2.50, sortOrder: 13 },
  { nameAr: 'مجمع الأعمال', fee: 2.50, sortOrder: 14 },
  { nameAr: 'مكة مول', fee: 2.50, sortOrder: 15 },
  { nameAr: 'سيتي مول', fee: 2.50, sortOrder: 16 },
  { nameAr: 'أم أذينة', fee: 2.50, sortOrder: 17 },
  { nameAr: 'طلوع نيفين', fee: 2.50, sortOrder: 18 },
  { nameAr: 'السادس', fee: 3.00, sortOrder: 19 },
  { nameAr: 'الخامس', fee: 3.00, sortOrder: 20 },
  { nameAr: 'الرابع', fee: 3.00, sortOrder: 21 },
  { nameAr: 'الشميساني', fee: 3.00, sortOrder: 22 },
  { nameAr: 'صويلح', fee: 3.00, sortOrder: 23 },
  { nameAr: 'دابوق', fee: 3.00, sortOrder: 24 },
  { nameAr: 'الجبيهة', fee: 3.00, sortOrder: 25 },
  { nameAr: 'الكرسي', fee: 3.00, sortOrder: 26 },
  { nameAr: 'عرجان', fee: 3.00, sortOrder: 27 },
  { nameAr: 'المدينة الرياضية', fee: 3.00, sortOrder: 28 },
  { nameAr: 'السهل', fee: 3.00, sortOrder: 29 },
  { nameAr: 'السابع', fee: 3.00, sortOrder: 30 },
  { nameAr: 'الصويفية', fee: 3.00, sortOrder: 31 },
  { nameAr: 'الرونق', fee: 3.50, sortOrder: 32 },
  { nameAr: 'البيادر', fee: 3.50, sortOrder: 33 },
  { nameAr: 'دوار الداخلية', fee: 3.50, sortOrder: 34 },
  { nameAr: 'العبدلي', fee: 3.50, sortOrder: 35 },
  { nameAr: 'وادي صقرة', fee: 3.50, sortOrder: 36 },
  { nameAr: 'مستشفى الإسلامي', fee: 3.50, sortOrder: 37 },
  { nameAr: 'دير غبار', fee: 3.50, sortOrder: 38 },
  { nameAr: 'عبدون', fee: 3.50, sortOrder: 39 },
  { nameAr: 'الحسين', fee: 3.50, sortOrder: 40 },
  { nameAr: 'جبل عمان', fee: 3.50, sortOrder: 41 },
  { nameAr: 'أم الأسود', fee: 3.50, sortOrder: 42 },
  { nameAr: 'أم زويتنة', fee: 3.50, sortOrder: 43 },
  { nameAr: 'الكمالية', fee: 3.50, sortOrder: 44 },
  { nameAr: 'حي المنصور', fee: 4.00, sortOrder: 45 },
  { nameAr: 'ضاحية الأقصى', fee: 4.00, sortOrder: 46 },
  { nameAr: 'ضاحية الاستقلال', fee: 4.00, sortOrder: 47 },
  { nameAr: 'النزهة', fee: 4.00, sortOrder: 48 },
  { nameAr: 'عين الباشا', fee: 4.00, sortOrder: 49 },
  { nameAr: 'ضاحية الأمير حسن', fee: 4.00, sortOrder: 50 },
  { nameAr: 'مستشفى الاستقلال', fee: 4.00, sortOrder: 51 },
  { nameAr: 'اللويبدة', fee: 4.00, sortOrder: 52 },
  { nameAr: 'طبربور', fee: 4.00, sortOrder: 53 },
  { nameAr: 'راس العين', fee: 4.00, sortOrder: 54 },
  { nameAr: 'شارع الرينبو', fee: 4.00, sortOrder: 55 },
  { nameAr: 'أبو السوس', fee: 4.00, sortOrder: 56 },
  { nameAr: 'أم السوس', fee: 4.00, sortOrder: 57 },
  { nameAr: 'ماحص', fee: 4.00, sortOrder: 58 },
  { nameAr: 'الفحيص', fee: 4.00, sortOrder: 59 },
  { nameAr: 'وادي السير', fee: 4.00, sortOrder: 60 },
  { nameAr: 'صافوط', fee: 4.00, sortOrder: 61 },
  { nameAr: 'الياسمين', fee: 5.00, sortOrder: 62 },
  { nameAr: 'أبو نصير', fee: 5.00, sortOrder: 63 },
  { nameAr: 'شفا بدران', fee: 5.00, sortOrder: 64 },
  { nameAr: 'الكوم', fee: 5.00, sortOrder: 65 },
  { nameAr: 'مرج الحمام', fee: 5.00, sortOrder: 66 },
  { nameAr: 'إسكان التلفزيون', fee: 5.00, sortOrder: 67 },
  { nameAr: 'أبو عليا', fee: 5.00, sortOrder: 68 },
  { nameAr: 'البقعة', fee: 5.00, sortOrder: 69 },
  { nameAr: 'الهاشمي وسط البلد', fee: 5.00, sortOrder: 70 },
  { nameAr: 'بدر الجديدة', fee: 5.00, sortOrder: 71 },
  { nameAr: 'الربحية الشمالية', fee: 5.00, sortOrder: 72 },
  { nameAr: 'الربحية الجنوبية', fee: 5.00, sortOrder: 73 },
  { nameAr: 'الأشرفية', fee: 5.00, sortOrder: 74 },
  { nameAr: 'حي الصحابة', fee: 5.00, sortOrder: 75 },
  { nameAr: 'رغدان', fee: 5.00, sortOrder: 76 },
  { nameAr: 'جبل النصر', fee: 6.00, sortOrder: 77 },
  { nameAr: 'عدن', fee: 6.00, sortOrder: 78 },
  { nameAr: 'حي نزال', fee: 6.00, sortOrder: 79 },
  { nameAr: 'جبل الأخضر', fee: 6.00, sortOrder: 80 },
  { nameAr: 'المقابلين', fee: 6.00, sortOrder: 81 },
  { nameAr: 'جبل الزهور', fee: 6.00, sortOrder: 82 },
  { nameAr: 'البنيات', fee: 6.00, sortOrder: 83 },
  { nameAr: 'عراق الأمير', fee: 6.00, sortOrder: 84 },
  { nameAr: 'ضاحية الحاج حسن', fee: 6.00, sortOrder: 85 },
  { nameAr: 'شارع الحرية', fee: 6.00, sortOrder: 86 },
  { nameAr: 'المنارة', fee: 6.00, sortOrder: 87 },
  { nameAr: 'ام النوارة', fee: 6.00, sortOrder: 88 },
  { nameAr: 'الوحدات', fee: 6.00, sortOrder: 89 },
  { nameAr: 'ناعور', fee: 6.00, sortOrder: 90 },
  { nameAr: 'أبو علندا', fee: 7.00, sortOrder: 91 },
  { nameAr: 'جاوا', fee: 7.00, sortOrder: 92 },
  { nameAr: 'الجويدة', fee: 7.00, sortOrder: 93 },
  { nameAr: 'خريبة السوق', fee: 7.00, sortOrder: 94 },
  { nameAr: 'ماركا الشمالية', fee: 7.00, sortOrder: 95 },
  { nameAr: 'ماركا الجنوبية', fee: 7.00, sortOrder: 96 },
  { nameAr: 'القويسمة', fee: 7.00, sortOrder: 97 },
  { nameAr: 'اليادودة', fee: 7.00, sortOrder: 98 },
  { nameAr: 'صالحية العابد', fee: 7.00, sortOrder: 99 },
  { nameAr: 'الجبل الشمالي (الرصيفة)', fee: 9.00, sortOrder: 100 },
  { nameAr: 'سحاب', fee: 9.00, sortOrder: 101 },
  { nameAr: 'المشيرفة', fee: 9.00, sortOrder: 102 }
];

async function main() {
  console.log('🚀 Starting Delivery Zones Migration...');
  
  for (const zone of zones) {
    await prisma.deliveryZone.upsert({
      where: { nameAr: zone.nameAr },
      update: { fee: zone.fee, sortOrder: zone.sortOrder },
      create: { 
        nameAr: zone.nameAr, 
        fee: zone.fee, 
        sortOrder: zone.sortOrder,
        isActive: true 
      }
    });
  }
  
  console.log('✅ Successfully migrated all zones to the database.');
}

main()
  .catch((e) => {
    console.error('❌ Migration Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
