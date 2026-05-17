import prisma from './config/prisma';

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Clean existing records safely
  console.log('🧹 Cleaning existing Promotions and Products...');
  await prisma.promotion.deleteMany({});
  await prisma.product.deleteMany({});

  // 2. Create products
  console.log('📦 Seeding Products...');
  const shirtBlue = await prisma.product.create({
    data: {
      name: 'Premium Blue Shirt',
      category: 'Shirts',
      sku: 'SHIRT-BLUE-001',
      base_price: 100.0,
      stock_quantity: 150,
    },
  });

  const shirtRed = await prisma.product.create({
    data: {
      name: 'Standard Red Shirt',
      category: 'Shirts',
      sku: 'SHIRT-RED-002',
      base_price: 50.0,
      stock_quantity: 200,
    },
  });

  const shoesRun = await prisma.product.create({
    data: {
      name: 'Running Sneakers',
      category: 'Shoes',
      sku: 'SHOES-RUN-003',
      base_price: 150.0,
      stock_quantity: 80,
    },
  });

  console.log(`✅ Seeded ${3} products successfully.`);

  // 3. Create promotions
  console.log('🎉 Seeding Promotion Rules (Scenario B - Overlapping Conflicts)...');
  
  const now = new Date();
  const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Active since yesterday
  const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Active for 7 more days

  // Category Level: 10% off all Shirts
  await prisma.promotion.create({
    data: {
      name: 'Summer Shirt 10% Sale',
      discount_type: 'PERCENTAGE',
      value: 10.0,
      target_type: 'CATEGORY',
      target_id: 'Shirts',
      start_date: startDate,
      end_date: endDate,
    },
  });

  // Product Level: $15 off the Premium Blue Shirt (SHIRT-BLUE-001)
  await prisma.promotion.create({
    data: {
      name: 'Super Direct Blue Shirt $15 Off',
      discount_type: 'FIXED',
      value: 15.0,
      target_type: 'PRODUCT',
      target_id: shirtBlue.id,
      start_date: startDate,
      end_date: endDate,
    },
  });

  console.log('✅ Seeded Promotion rules successfully.');
  console.log('⭐ Database seeding complete. Ready for pricing engine tests!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
