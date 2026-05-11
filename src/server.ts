
import { app } from './app.js';
import { env } from './env/index.js';
import { logger } from './shared/logger.js';
import '../src/integrations/IA/chatbot.worker.js'; 
import './shared/worker/payment.queue.js';
import { setupSocket } from './shared/socket/socket.js';
// Importa o worker do chatbot para que ele comece a processar os jobs da fila
async function bootstrap() {

  setupSocket(app.server)

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`Servidor rodando na porta ${env.PORT}`);
    logger.info(`Documentacao disponivel em http://localhost:${env.PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();

// --- Graceful Shutdown ---
const signals = ['SIGINT', 'SIGTERM'];

signals.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`\n${signal} recebido. Desligando graciosamente...`);
    
    try {
      // Aqui futuramente adicionaremos:
      // await prisma.$disconnect();
      // await redis.quit();
      await app.close();
      logger.info('Servidor encerrado com sucesso.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Erro ao encerrar a aplicação.');
      process.exit(1);
    }
  });
});