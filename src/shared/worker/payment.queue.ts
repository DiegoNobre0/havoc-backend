import { Queue, Worker } from 'bullmq';
import { redis } from '../redis/redis.js';
import { PaymentsService } from '../../modules/payments/payments.service.js';

// 1. Cria a Fila
export const paymentQueue = new Queue('payment-webhook', { connection: redis as any });

// 2. Cria o Worker 
export const paymentWorker = new Worker(
  'payment-webhook',
  async (job) => {
    const { paymentId } = job.data;
    const paymentsService = new PaymentsService();
    
    console.log(`[Worker Payment] ⚙️ Processando webhook do MP... ID: ${paymentId}`);
    await paymentsService.processWebhook(paymentId);
  },
  { 
    connection: redis as any,
    concurrency: 5 // Processa até 5 pagamentos ao mesmo tempo
  }
);

paymentWorker.on('completed', (job) => console.log(`[Worker Payment] ✅ Job ${job.id} concluído.`));
paymentWorker.on('failed', (job, err) => console.error(`[Worker Payment] 🚨 Job ${job?.id} falhou:`, err));