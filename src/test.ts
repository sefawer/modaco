import prisma from './config/prisma';
import { getProducts } from './services/product.service';
import { getCache } from './services/cache.service';
import redisClient, { connectRedis } from './config/redis';

async function runTests() {
  console.log('🧪 Starting ModaCo Promotion Engine Integration Tests...');

  // Connect to Redis
  console.log('🔄 Connecting to Redis...');
  await connectRedis();

  // 1. Verify Seeding has been applied
  console.log('🔍 Checking seeded database state...');
  
  const products = await getProducts();
  if (products.length === 0) {
    throw new Error('❌ Test database is empty! Please run database seeding first.');
  }

  // 2. Locate our seeded products in the resolved catalog
  const blueShirt = products.find((p: any) => p.sku === 'SHIRT-BLUE-001');
  const redShirt = products.find((p: any) => p.sku === 'SHIRT-RED-002');
  const sneakers = products.find((p: any) => p.sku === 'SHOES-RUN-003');

  if (!blueShirt || !redShirt || !sneakers) {
    throw new Error('❌ Seeded products could not be found in catalog!');
  }

  let failed = false;

  // Test Case 1: Overlapping dynamic prioritization (Premium Blue Shirt)
  // Base Price: $100. Category: Shirts (10% off -> $90). Product specific ($15 off -> $85).
  // Winner: $15 Direct Fixed Discount (saves the customer $15 instead of $10).
  console.log('\n📋 TEST CASE 1: Dynamic Overlapping Resolution (Blue Shirt)');
  console.log(`- Base Price: $${blueShirt.base_price}`);
  console.log(`- Resolved Effective Price: $${blueShirt.effective_price}`);
  console.log(`- Applied Promotion: "${blueShirt.applied_promotion?.name || 'None'}"`);

  if (Math.abs(blueShirt.effective_price - 85.0) < 0.001) {
    console.log('🟢 [PASS] Premium Blue Shirt resolved to $85 (Direct Fixed discount wins over Category Percentage discount).');
  } else {
    console.log(`🔴 [FAIL] Expected price to be $85, but got $${blueShirt.effective_price}`);
    failed = true;
  }

  // Test Case 2: Standard Category discount resolution (Standard Red Shirt)
  // Base Price: $50. Category: Shirts (10% off -> $45). Product specific (None).
  // Winner: 10% Category Discount (saves $5).
  console.log('\n📋 TEST CASE 2: Category Promotion Resolution (Red Shirt)');
  console.log(`- Base Price: $${redShirt.base_price}`);
  console.log(`- Resolved Effective Price: $${redShirt.effective_price}`);
  console.log(`- Applied Promotion: "${redShirt.applied_promotion?.name || 'None'}"`);

  if (Math.abs(redShirt.effective_price - 45.0) < 0.001) {
    console.log('🟢 [PASS] Standard Red Shirt resolved to $45 (only Category Percentage discount applies).');
  } else {
    console.log(`🔴 [FAIL] Expected price to be $45, but got $${redShirt.effective_price}`);
    failed = true;
  }

  // Test Case 3: No active promotion resolution (Running Sneakers)
  // Base Price: $150. Category: Shoes (None). Product specific (None).
  // Winner: None.
  console.log('\n📋 TEST CASE 3: No Active Promotion Resolution (Sneakers)');
  console.log(`- Base Price: $${sneakers.base_price}`);
  console.log(`- Resolved Effective Price: $${sneakers.effective_price}`);
  console.log(`- Applied Promotion: "${sneakers.applied_promotion?.name || 'None'}"`);

  if (Math.abs(sneakers.effective_price - 150.0) < 0.001) {
    console.log('🟢 [PASS] Running Sneakers resolved to $150 (no promotions apply).');
  } else {
    console.log(`🔴 [FAIL] Expected price to be $150, but got $${sneakers.effective_price}`);
    failed = true;
  }

  // Test Case 4: Cache-Aside Redis check
  console.log('\n📋 TEST CASE 4: Redis Cache-Aside Validation');
  const cacheKey = 'products:all:1:20';
  const cachedData = await getCache(cacheKey);

  if (cachedData) {
    console.log('🟢 [PASS] Redis Cache-Aside lookup works correctly (Products catalog cached in Redis).');
  } else {
    console.log('🔴 [FAIL] Expected products catalog to be cached in Redis, but cache lookup returned null.');
    failed = true;
  }

  console.log('\n=============================================');
  
  // Clean disconnect of Redis client to allow script to exit
  await redisClient.disconnect();

  if (!failed) {
    console.log('🏆 ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! [4/4 PASS]');
    process.exit(0);
  } else {
    console.log('❌ SOME INTEGRATION TESTS FAILED!');
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('💥 Test suite crashed:', error);
  process.exit(1);
});
