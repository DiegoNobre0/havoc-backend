import { Queue } from 'bullmq';
import { redis } from '../redis/redis.js';

export type ProductLabelJob = {
  productId: string;
  identityHash: string;
  labelVersion: number;
};

export const productLabelQueue = new Queue<ProductLabelJob>('product-label-queue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 2_000 },
  },
});

export function enqueueProductLabelSync(productId: string, identityHash: string, labelVersion = 1) {
  return productLabelQueue.add(
    'sync-product-label',
    { productId, identityHash, labelVersion },
    {
      deduplication: {
        id: `product-label-${productId}-${identityHash.slice(0, 16)}-${labelVersion}`,
        ttl: 5 * 60_000,
      },
    },
  );
}
