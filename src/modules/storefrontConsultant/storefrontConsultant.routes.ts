import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { StorefrontConsultantController } from './storefrontConsultant.controller.js';
import {
  consultantSessionParamsSchema,
  consultantTokenHeadersSchema,
  consultantAudioQuerySchema,
  createConsultantMessageSchema,
  createConsultantSessionSchema,
} from './storefrontConsultant.schemas.js';

export async function storefrontConsultantRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const controller = new StorefrontConsultantController();

  routes.post(
    '/sessions',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Storefront - Consultor'],
        summary: 'Cria uma sessão pública do consultor',
        body: createConsultantSessionSchema,
      },
    },
    controller.createSession.bind(controller),
  );

  routes.get(
    '/sessions/:sessionId',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Storefront - Consultor'],
        summary: 'Recupera a sessão e o histórico do consultor',
        params: consultantSessionParamsSchema,
        headers: consultantTokenHeadersSchema,
      },
    },
    controller.getSession.bind(controller),
  );

  routes.delete(
    '/sessions/:sessionId',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['Storefront - Consultor'],
        summary: 'Encerra e remove a sessão atual do consultor',
        params: consultantSessionParamsSchema,
        headers: consultantTokenHeadersSchema,
      },
    },
    controller.endSession.bind(controller),
  );

  routes.post(
    '/sessions/:sessionId/messages',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['Storefront - Consultor'],
        summary: 'Envia uma mensagem ao consultor',
        params: consultantSessionParamsSchema,
        headers: consultantTokenHeadersSchema,
        body: createConsultantMessageSchema,
      },
    },
    controller.sendMessage.bind(controller),
  );

  routes.post(
    '/sessions/:sessionId/audio',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['Storefront - Consultor'],
        summary: 'Transcreve um áudio e envia a mensagem ao consultor',
        consumes: ['multipart/form-data'],
        params: consultantSessionParamsSchema,
        headers: consultantTokenHeadersSchema,
        querystring: consultantAudioQuerySchema,
      },
    },
    controller.sendAudio.bind(controller),
  );
}
