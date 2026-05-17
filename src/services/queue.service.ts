import { Queue, Worker } from 'bullmq';
import { invalidateCachePattern } from './cache.service';
import prisma from '../config/prisma';

const redisOptions = {
  host: 'localhost',
  port: 6379,
};

export const promotionQueue = new Queue('promotion-events', { connection: redisOptions });

// Worker that listens to promotion events
export const promotionWorker = new Worker('promotion-events', async (job) => {
  const { action, target_type, target_id, promotion_id } = job.data;

  console.log(`[Worker] Processing job: ${job.name} - Action: ${action}`);

  if (action === 'APPLY_PROMOTION') {
    // Invalidate product caches
    if (target_type === 'PRODUCT') {
      await invalidateCachePattern(`product:${target_id}`);
    } else if (target_type === 'CATEGORY') {
      // Invalidate category listing cache
      await invalidateCachePattern(`products:category:${target_id}:*`);
      // Update all products in the database if necessary or just let the real-time cache handle it
      // For heavy write, we do it in batches or just let the cache invalidation handle it so on next read they fetch the active promotion.
    }
    
    // Invalidate general product listings
    await invalidateCachePattern('products:all:*');
  }

  if (action === 'CANCEL_PROMOTION') {
    await invalidateCachePattern('products:*');
    await invalidateCachePattern('product:*');
  }
}, { connection: redisOptions });

promotionWorker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} has completed!`);
});

promotionWorker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job?.id} has failed with ${err.message}`);
});
