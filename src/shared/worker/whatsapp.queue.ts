import { Queue } from 'bullmq';
import { redis } from '../redis/redis.js';

// ─────────────────────────────────────────────────────────────
// FILA — WhatsApp & Bot Jobs
// ─────────────────────────────────────────────────────────────

export const whatsappQueue = new Queue('whatsapp-queue', { 
  connection: redis as any,
  defaultJobOptions: { 
    attempts: 3, 
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true, // Mantém o Redis limpo
    removeOnFail: false,    // Permite debugar jobs que falharam
  }
});