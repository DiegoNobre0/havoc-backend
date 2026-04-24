import { Redis } from 'ioredis';
import { env } from '../../env/index.js';

// Criamos a instância de conexão usando a URL validada do Zod
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Configuração recomendada para usarmos com BullMQ no futuro
});

// Logs para sabermos que conectou certinho (opcional, mas ótimo para debug)
redis.on('connect', () => {
  console.log('🟢 Redis conectado com sucesso!');
});

redis.on('error', (err) => {
  console.error('🔴 Erro na conexão com o Redis:', err);
});