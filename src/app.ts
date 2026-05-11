import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';

import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { errorHandler } from './shared/middlewares/error.middleware.js';
import { logger } from './shared/logger.js';
import jwt from '@fastify/jwt';
import { env } from './env/index.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { whatsappWebhookRoutes } from './modules/whatsappWebhook/whatsAppWebhook.routes.js';
import { chatbotRoutes } from './modules/chatbot/chatbot.routes.js';
import { shippingRoutes } from './modules/shipping/shipping.routes.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';

export const app = fastify({
  loggerInstance: logger, 
  
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.setErrorHandler(errorHandler);

// Segurança base
app.register(helmet);
app.register(cors, {
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], // 👈 O PATCH e OPTIONS precisam estar aqui!
  allowedHeaders: ['Content-Type', 'Authorization'],
});
app.register(jwt, {
  secret: env.JWT_SECRET,
});

// Proteção contra DDoS básico
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Configuração do Swagger / OpenAPI
app.register(swagger, {
  openapi: {
    info: {
      title: 'Havoc Suplementos API',
      description: 'Documentação completa da API do backend.',
      version: '1.0.0',
    },
    // Adicione este bloco:
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  transform: jsonSchemaTransform,
});
app.register(swaggerUi, {
  routePrefix: '/docs',
});

app.register(multipart);

// Rota de Healthcheck
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date() };
});

app.register(usersRoutes, { prefix: '/users' });
app.register(authRoutes, { prefix: '/auth' });
app.register(dashboardRoutes, { prefix: '/dashboard' });
app.register(catalogRoutes, { prefix: '/catalog' });
app.register(whatsappWebhookRoutes, { prefix: '/webhook/whatsapp' });
app.register(chatbotRoutes, { prefix: '/chatbot' })
app.register(shippingRoutes, { prefix: '/shipping' });
app.register(paymentsRoutes, { prefix: '/payments' });