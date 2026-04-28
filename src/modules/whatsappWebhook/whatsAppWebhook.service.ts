import crypto from 'crypto';


import { ParsedMessage, WebhookMessagePayload } from './whatsappWebhook.types.js';
import { redis } from '../../shared/redis/redis.js';
import { whatsappQueue } from '../../shared/worker/whatsapp.queue.js';


export class WhatsAppWebhookService {
  
  // ─── 1. Verificação de Assinatura e Setup ──────────────────

  verifyToken(mode: string, token: string, challenge: string) {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'havoc_suplementos_2026';
    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }
    throw new Error('Verification failed');
  }

  verifySignature(signature: string, rawBody: string) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      console.warn('⚠️ META_APP_SECRET não configurado. Pulando validação de assinatura.');
      return true;
    }
    
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const expectedSignature = `sha256=${expectedHash}`;
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  // ─── 2. Fluxo Principal de Processamento ───────────────────

  async processWebhook(body: any) {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messageData = value?.messages?.[0] as WebhookMessagePayload;
      const businessPhoneNumber = value?.metadata?.display_phone_number;

      // Se não for uma mensagem de usuário (ex: status de lido/entregue), ignora silenciosamente
      if (!messageData || !businessPhoneNumber) return;

      // Proteção contra duplicação (Idempotência da Meta)
      const isDuplicate = await redis.setnx(`processed_msg:${messageData.id}`, '1');
      if (isDuplicate === 0) {
        return; // Já processamos esta mensagem (Meta mandou em duplicidade)
      }
      await redis.expire(`processed_msg:${messageData.id}`, 300); // Guarda por 5 minutos

      // 3. Parser da Mensagem
      const parsedMessage = this.parseMessage(messageData);

      // 4. Envia diretamente para o Cérebro do Bot (Fila do BullMQ)
      // Passamos o número do WhatsApp como a sessionKey para o Prisma
      await whatsappQueue.add('process-chat-message', {
        sessionKey: parsedMessage.phone, // Ex: "5511999999999"
        message: parsedMessage,
      });

    } catch (error) {
      console.error('[Webhook Process Error]:', error);
    }
  }

  // ─── 3. Parser Universal ───────────────────────────────────

  private parseMessage(msg: WebhookMessagePayload): ParsedMessage {
    const cleanPhone = msg.from.replace(/\D/g, '');
    let content = '';

    switch (msg.type) {
      case 'text':
        content = msg.text?.body || '';
        break;
      case 'audio':
        content = msg.audio?.id || ''; // Enviaremos aúdio pro Whisper/Groq dps
        break;
      case 'image':
        content = msg.image?.id || '';
        break;
      case 'interactive':
        if (msg.interactive?.type === 'button_reply') {
          content = msg.interactive.button_reply?.id || '';
        } else if (msg.interactive?.type === 'list_reply') {
          content = msg.interactive.list_reply?.id || '';
        }
        break;
      default:
        content = '[Tipo de mensagem não suportado]';
        msg.type = 'unknown';
    }

    return {
      messageId: msg.id,
      phone: cleanPhone,
      type: msg.type,
      content,
      raw_payload: msg, 
    };
  }
}