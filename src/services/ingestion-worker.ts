import { Worker } from 'bullmq';
import prisma from '../config/prisma';

const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const ingestionWorker = new Worker('product-ingestion', async (job) => {
  const { items } = job.data;
  console.log(`[Worker] Processing ingestion chunk of ${items.length} items`);

  // Batch insert/upsert using Prisma transaction for atomicity
  try {
    await prisma.$transaction(
      items.map((item: any) => 
        prisma.product.upsert({
          where: { sku: item.sku },
          update: {
            base_price: item.base_price,
            stock_quantity: item.stock_quantity,
            // Assuming dynamic pricing rules are applied here before saving
            // e.g., base_price = applyPricingRules(item.base_price)
          },
          create: {
            name: item.name,
            category: item.category,
            sku: item.sku,
            base_price: item.base_price,
            stock_quantity: item.stock_quantity,
          }
        })
      )
    );
  } catch (error) {
    console.error(`[Worker] Failed to process chunk`, error);
    throw error;
  }
}, { connection: redisOptions });

ingestionWorker.on('completed', job => {
  console.log(`[Worker] Ingestion Job ${job.id} has completed!`);
});

ingestionWorker.on('failed', (job, err) => {
  console.log(`[Worker] Ingestion Job ${job?.id} has failed with ${err.message}`);
});
