import crypto from 'crypto';
import { ParsedMessage, WebhookMessagePayload } from './whatsappWebhook.types.js';
import { redis } from '../../shared/redis/redis.js';
import { whatsappQueue } from '../../shared/worker/whatsapp.queue.js';

export class WhatsAppWebhookService {

  // ─── 1. Verificação de Token e Assinatura ──────────────────
  verifyToken(mode: string, token: string, challenge: string) {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'havoc_suplementos_2026';
    if (mode === 'subscribe' && token === verifyToken) return challenge;
    throw new Error('Verification failed');
  }

  verifySignature(signature: string, rawBody: string) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      console.warn('⚠️ META_APP_SECRET não configurado. Pulando validação.');
      return true;
    }
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${expectedHash}`)
    );
  }

  // ─── 2. Fluxo Principal ────────────────────────────────────
  async processWebhook(body: any) {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messageData = value?.messages?.[0] as WebhookMessagePayload;
      const statusesData = value?.statuses?.[0];
      const businessPhoneNumber = value?.metadata?.display_phone_number;

      // Ignora eventos de status (lido/entregue)
      if (statusesData) return;
      if (!messageData || !businessPhoneNumber) return;

      // Deduplicação atômica
      const dedupe = await redis.set(
        `processed_msg:${messageData.id}`, '1', 'EX', 300, 'NX'
      );
      if (!dedupe) {
        console.log(`[Webhook] ⚠️ Duplicata ignorada: ${messageData.id}`);
        return;
      }

      const parsedMessage = this.parseMessage(messageData);


      // Detecta clique em botão interativo
      const interactiveData: any = messageData?.interactive;
      if (interactiveData?.type === 'button_reply') {
        const buttonId = interactiveData.button_reply.id as string;

        // ✅ DEDUPE DE BOTÃO: evita duplo clique no mesmo botão
        const buttonDedupeKey = `btn_dedupe:${parsedMessage.phone}:${buttonId}`;
        const alreadyClicked = await redis.set(buttonDedupeKey, '1', 'EX', 60, 'NX');
        if (!alreadyClicked) {
          console.log(`[Webhook] ⚠️ Clique duplo ignorado: ${buttonId}`);
          return;
        }

        await whatsappQueue.add('process-chat-message', {
          sessionKey: parsedMessage.phone,
          message: {
            ...parsedMessage,
            type: 'text',
            content: buttonId.startsWith('CONFIRM_YES:')
              ? `[PRODUTO_CONFIRMADO] ${buttonId.replace('CONFIRM_YES:', '')}`
              : buttonId === 'CONFIRM_CHECKOUT'
                ? '[FINALIZAR_PEDIDO] Cliente quer finalizar agora.'
                : buttonId === 'VER_SUGESTAO'
                  ? 'Sim, quero ver essa sugestão!' // 👈 Nova linha que mapeia o clique
                  : 'Quero ver outras opções',
          },
        });
        return;
      }
      // Mensagem normal → fila
      await whatsappQueue.add('process-chat-message', {
        sessionKey: parsedMessage.phone,
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
        content = msg.audio?.id || '';
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