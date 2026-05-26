import { Queue, Worker } from 'bullmq';
import { redis } from '../redis/redis.js';
import { PaymentsService } from '../../modules/payments/payments.service.js';

// 1. Cria a Fila
export const paymentQueue = new Queue('payment-webhook', { connection: redis as any });

// 2. Cria o Worker
export const paymentWorker = new Worker(
  'payment-webhook',
  async (job) => {
    // 👉 Agora extraímos o body e os headers que vieram do Controller
    const { body, headers } = job.data;
    const paymentsService = new PaymentsService();

    // Tenta pegar o ID para manter o log organizado
    const paymentIdLog = body?.data?.id || body?.resource || 'Desconhecido';

    console.log(`[Worker Payment] ⚙️ Processando webhook do MP... ID: ${paymentIdLog}`);

    // 👉 Aciona o service passando os dois parâmetros para a validação de segurança
    await paymentsService.processWebhook(body, headers);
  },
  {
    connection: redis as any,
    concurrency: 5, // Processa até 5 pagamentos ao mesmo tempo
  },
);

paymentWorker.on('completed', (job) => console.log(`[Worker Payment] ✅ Job ${job.id} concluído.`));
paymentWorker.on('failed', (job, err) =>
  console.error(`[Worker Payment] 🚨 Job ${job?.id} falhou:`, err),
);
