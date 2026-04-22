import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import errorMiddleware = require('./shared/middlewares/error.middleware');
import { logger } from './shared/logger.js';

export const app = fastify({
  logger: logger,
});

app.setErrorHandler(errorMiddleware.errorHandler);

// Segurança base
app.register(helmet);
app.register(cors, {
  origin: true, // Em produção, colocar a URL do frontend Angular
});

// Proteção contra DDoS básico
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Configuração do Swagger / OpenAPI
app.register(swagger, {
  swagger: {
    info: {
      title: 'Havoc Suplementos API',
      description: 'Documentação completa da API do backend.',
      version: '1.0.0',
    },
    consumes: ['application/json'],
    produces: ['application/json'],
  },
});

app.register(swaggerUi, {
  routePrefix: '/docs',
});

// Rota de Healthcheck
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date() };
});