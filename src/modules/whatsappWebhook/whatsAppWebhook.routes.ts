import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WhatsAppWebhookController } from './whatsappWebhook.controller.js';

const controller = new WhatsAppWebhookController();

// ─── SCHEMAS DO ZOD ───────────────────────────────────────────
const verifyQuerySchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

const webhookHeadersSchema = z.object({
  'x-hub-signature-256': z.string().optional(),
}).passthrough(); // Permite que outros cabeçalhos passem sem erro

// Usamos z.any() no body porque os payloads da Meta são gigantes e variáveis. 
// O nosso parser (no Service) é quem cuida de extrair o que importa.
const webhookBodySchema = z.any(); 
// ──────────────────────────────────────────────────────────────

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  
  // Mantemos o parser do rawBody vital para a validação da assinatura da Meta
  app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    try {
      const json = JSON.parse(body as string);
      (req as any).rawBody = body;
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // ─── ROTA GET: Validação da Meta ───
  app.withTypeProvider<ZodTypeProvider>().get('/', {
    schema: {
      tags: ['Webhook WhatsApp'],
      summary: 'Endpoint para a validação de token da API Cloud do WhatsApp',
      querystring: verifyQuerySchema,
    }
  }, controller.verify.bind(controller));


  // ─── ROTA POST: Recebimento de Mensagens ───
  app.withTypeProvider<ZodTypeProvider>().post('/', {
    schema: {
      tags: ['Webhook WhatsApp'],
      summary: 'Recebe mensagens e eventos de status do WhatsApp',
      headers: webhookHeadersSchema,
      body: webhookBodySchema,
    }
  }, controller.handle.bind(controller));
}