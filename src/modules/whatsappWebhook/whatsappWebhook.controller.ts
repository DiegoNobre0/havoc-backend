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
    console.log('\n==================================================');
    console.log(`[Webhook Controller] 📥 Novo POST recebido da Meta!`);
    
    const signature = request.headers['x-hub-signature-256'] as string;
    const rawBody = (request as any).rawBody || JSON.stringify(request.body);

    if (signature) {
      console.log(`[Webhook Controller] 🔐 Verificando assinatura de segurança...`);
      const isValid = webhookService.verifySignature(signature, rawBody);
      if (!isValid) {
        console.warn('⚠️ [Webhook Controller] Webhook rejeitado: Assinatura da Meta inválida.');
        return reply.status(401).send({ error: 'Invalid Signature' });
      }
      console.log(`[Webhook Controller] ✅ Assinatura válida!`);
    } else {
      console.log(`[Webhook Controller] ⚠️ Nenhuma assinatura recebida no header (Normal se for teste manual).`);
    }

    // 🏆 Padrão Ouro: Libera a requisição da Meta imediatamente
    console.log(`[Webhook Controller] ⚡ Retornando 200 OK para a Meta imediatamente.`);
    reply.status(200).send({ status: 'RECEIVED' });

    // Processa em background (Parser -> BullMQ)
    console.log(`[Webhook Controller] 🔄 Iniciando processamento do payload em background...`);
    webhookService.processWebhook(request.body).catch(err => {
      console.error('[Webhook Async Error]:', err);
    });
  }
}