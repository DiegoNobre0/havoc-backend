import type { FastifyRequest, FastifyReply } from 'fastify';
import { WhatsAppWebhookService } from './whatsAppWebhook.service.js';


const webhookService = new WhatsAppWebhookService();

export class WhatsAppWebhookController {
  
  // Rota GET: Validação inicial exigida pela Meta
  async verify(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = request.query as any;
      const challenge = webhookService.verifyToken(
        query['hub.mode'],
        query['hub.verify_token'],
        query['hub.challenge']
      );
      return reply.status(200).send(challenge);
    } catch (error) {
      return reply.status(403).send({ error: 'Verification Failed' });
    }
  }

  // Rota POST: Recebimento das mensagens
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const signature = request.headers['x-hub-signature-256'] as string;
    
    const rawBody = (request as any).rawBody || JSON.stringify(request.body);

    if (signature) {
      const isValid = webhookService.verifySignature(signature, rawBody);
      if (!isValid) {
        console.warn('⚠️ Webhook rejeitado: Assinatura da Meta inválida.');
        return reply.status(401).send({ error: 'Invalid Signature' });
      }
    }

    // 🏆 Padrão Ouro: Libera a requisição da Meta imediatamente
    reply.status(200).send({ status: 'RECEIVED' });

    // Processa em background (Parser -> BullMQ)
    webhookService.processWebhook(request.body).catch(err => {
      console.error('[Webhook Async Error]:', err);
    });
  }
}