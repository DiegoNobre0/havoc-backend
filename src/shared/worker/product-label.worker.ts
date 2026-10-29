import { Worker } from 'bullmq';
import { AppError } from '../errors/AppError.js';
import { redis } from '../redis/redis.js';
import { ProductFactsService } from '../../modules/catalog/productFacts/product-facts.service.js';
import type { ProductLabelJob } from './product-label.queue.js';

const factsService = new ProductFactsService();

export const productLabelWorker = new Worker<ProductLabelJob>(
  'product-label-queue',
  async (job) => {
    try {
      await factsService.sync(job.data.productId, {}, job.data.identityHash, job.data.labelVersion);
    } catch (error) {
      if (error instanceof AppError && [404, 409, 422].includes(error.statusCode)) return;
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 2,
    limiter: { max: 10, duration: 60_000 },
    lockDuration: 120_000,
  },
);
