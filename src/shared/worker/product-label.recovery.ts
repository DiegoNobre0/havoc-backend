import cron from 'node-cron';
import { prisma } from '../../database/prisma.js';
import { productIdentityHash } from '../../modules/catalog/productFacts/product-facts.identity.js';
import { enqueueProductLabelSync } from './product-label.queue.js';

const BATCH_SIZE = 100;

async function recoverProductLabelJobs() {
  const now = new Date();
  const staleProcessing = new Date(now.getTime() - 30 * 60_000);
  const [withoutLabel, dueLabels] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null, labelFacts: { is: null } },
      select: { id: true, name: true },
      take: BATCH_SIZE,
    }),
    prisma.productLabel.findMany({
      where: {
        product: { isActive: true, deletedAt: null },
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', lastSyncAttemptAt: { lt: staleProcessing } },
          {
            status: 'SOURCE_MATCHED',
            nextSyncAt: null,
            lastSyncAttemptAt: { lt: staleProcessing },
          },
          { status: { in: ['NOT_FOUND', 'FAILED', 'SOURCE_MATCHED'] }, nextSyncAt: { lte: now } },
        ],
      },
      select: { version: true, product: { select: { id: true, name: true } } },
      take: BATCH_SIZE,
    }),
  ]);

  for (const product of withoutLabel) {
    const identityHash = productIdentityHash(product.name);
    await prisma.productLabel.upsert({
      where: { productId: product.id },
      create: { productId: product.id, status: 'PENDING', identityHash },
      update: {},
    });
    await enqueueProductLabelSync(product.id, identityHash, 1);
  }

  for (const { product, version } of dueLabels) {
    await enqueueProductLabelSync(product.id, productIdentityHash(product.name), version);
  }
}

async function runRecovery() {
  try {
    await recoverProductLabelJobs();
  } catch (error) {
    console.error('Falha ao recuperar buscas automáticas de rótulo:', error);
  }
}

export const productLabelRecoveryTask = cron.schedule('15 * * * *', runRecovery);
setTimeout(runRecovery, 10_000).unref();
