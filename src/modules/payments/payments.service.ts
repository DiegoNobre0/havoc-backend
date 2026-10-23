import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import axiosStatic from 'axios';
import { io } from '../../shared/socket/socket.js';
import crypto from 'crypto';
import { WhatsAppIntegrationService } from '../../integrations/whatsapp/whatsappIntegration.service.js';
import { mapMercadoPagoStatus, mercadoPagoPaymentId } from './payments.utils.js';

type MercadoPagoPayment = {
  id: string | number;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  currency_id?: string;
  transaction_amount?: string | number;
  date_approved?: string;
};

export class PaymentsService {
  // ─── CREDENCIAIS MERCADO PAGO (VIA .ENV) ───────────────────────────
  // No seu .env, adicione: MERCADO_PAGO_ACCESS_TOKEN=APP_USR-12345...
  private readonly accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN!;
  private readonly baseUrl = 'https://api.mercadopago.com';

  private headers(idempotencyKey?: string) {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey && { 'X-Idempotency-Key': idempotencyKey }),
    };
  }

  private idempotencyKey(orderId: string, operation: 'pix' | 'link', attempt = 'initial') {
    return crypto
      .createHash('sha256')
      .update(`havoc:${operation}:${orderId}:${attempt}`)
      .digest('hex');
  }

  // ==============================================================
  // 👉 1. GERAR PIX (COBRANÇA IMEDIATA COM COPIA E COLA)
  // ==============================================================
  async generatePix(orderId: string, email: string, name: string, cpf?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    let existingPayment = await prisma.payment.findUnique({ where: { orderId } });
    if (existingPayment?.method === 'PIX' && existingPayment.status === 'PAID')
      return existingPayment;
    if (
      existingPayment?.method === 'PIX' &&
      existingPayment.status === 'PENDING' &&
      existingPayment.pixCode &&
      (!existingPayment.expiresAt || existingPayment.expiresAt.getTime() > Date.now())
    ) {
      return existingPayment;
    }
    if (
      existingPayment?.method === 'PIX' &&
      existingPayment.status === 'PENDING' &&
      existingPayment.expiresAt &&
      existingPayment.expiresAt.getTime() <= Date.now()
    ) {
      existingPayment = await prisma.payment.update({
        where: { id: existingPayment.id },
        data: { status: 'EXPIRED', providerStatus: 'expired' },
      });
    }

    // O MP exige um e-mail. Se for pedido via WhatsApp sem cadastro, usamos um fallback
    const payerEmail = email && email.includes('@') ? email : 'cliente@havocsuplementos.shop';
    const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : null;

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const payload = {
      transaction_amount: Number(order.total),
      description: `Pedido ${order.code} - Havoc Suplementos`,
      payment_method_id: 'pix',
      external_reference: orderId, // Crucial para vincular o webhook depois
      date_of_expiration: expiresAt.toISOString(),
      notification_url: `${process.env.API_PUBLIC_URL || 'https://api.havocsuplementos.shop'}/payments/webhook`,
      payer: {
        email: payerEmail,
        first_name: name,
        ...(cpfLimpo && { identification: { type: 'CPF', number: cpfLimpo } }),
      },
    };

    try {
      const response = await axiosStatic.post(`${this.baseUrl}/v1/payments`, payload, {
        headers: this.headers(
          this.idempotencyKey(
            orderId,
            'pix',
            existingPayment ? existingPayment.updatedAt.toISOString() : undefined,
          ),
        ),
      });

      const paymentData = response.data;
      const pixCode = paymentData.point_of_interaction?.transaction_data?.qr_code;
      const qrCodeBase64 = paymentData.point_of_interaction?.transaction_data?.qr_code_base64;
      const pixQrCodeUrl = qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : null;

      return await prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          method: 'PIX',
          amount: order.total,
          status: 'PENDING',
          externalId: String(paymentData.id),
          providerStatus: paymentData.status ?? 'pending',
          statusDetail: paymentData.status_detail ?? null,
          pixCode: pixCode,
          pixQrCodeUrl,
          expiresAt,
        },
        update: {
          method: 'PIX',
          status: 'PENDING',
          amount: order.total,
          externalId: String(paymentData.id),
          providerStatus: paymentData.status ?? 'pending',
          statusDetail: paymentData.status_detail ?? null,
          pixCode: pixCode,
          pixQrCodeUrl,
          paymentLink: null,
          paidAt: null,
          expiresAt,
        },
      });
    } catch (error: any) {
      console.error('[Mercado Pago Pix Error]:', error.response?.data || error.message);
      throw new AppError('Erro ao gerar PIX no Mercado Pago.', 500);
    }
  }

  // ==============================================================
  // 👉 2. GERAR LINK DE PAGAMENTO (CHECKOUT PRO / CARTÃO E BOLETO)
  // ==============================================================
  async generateLink(orderId: string, checkoutToken?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    const existingPayment = await prisma.payment.findUnique({ where: { orderId } });
    if (
      existingPayment?.method === 'PAYMENT_LINK' &&
      ['PENDING', 'PAID'].includes(existingPayment.status) &&
      existingPayment.paymentLink
    ) {
      return existingPayment;
    }

    const storefrontUrl =
      process.env.STOREFRONT_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://havocsuplementos.shop'
        : 'http://localhost:4200');
    const returnContext = checkoutToken
      ? `&orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(checkoutToken)}`
      : '';

    const payload = {
      items: [
        {
          title: `Pedido ${order.code} - Havoc Suplementos`,
          description: 'Suplementos e Vitaminas',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number(order.total),
        },
      ],
      external_reference: orderId,
      notification_url: `${process.env.API_PUBLIC_URL || 'https://api.havocsuplementos.shop'}/payments/webhook`,
      back_urls: {
        success: `${storefrontUrl}/checkout?payment=success${returnContext}`,
        pending: `${storefrontUrl}/checkout?payment=pending${returnContext}`,
        failure: `${storefrontUrl}/checkout?payment=failure${returnContext}`,
      },
      payment_methods: {
        excluded_payment_types: [
          { id: 'ticket' },
          { id: 'bank_transfer' },
          { id: 'atm' },
          { id: 'debit_card' },
        ],
      },
      auto_return: 'approved',
    };

    try {
      const response = await axiosStatic.post(`${this.baseUrl}/checkout/preferences`, payload, {
        headers: this.headers(
          this.idempotencyKey(
            orderId,
            'link',
            existingPayment ? existingPayment.updatedAt.toISOString() : undefined,
          ),
        ),
      });

      // init_point é o link oficial de produção do Mercado Pago
      const paymentLink = response.data.init_point;

      return await prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          method: 'PAYMENT_LINK',
          amount: order.total,
          status: 'PENDING',
          externalId: response.data.id,
          providerStatus: 'pending',
          paymentLink: paymentLink,
        },
        update: {
          method: 'PAYMENT_LINK',
          status: 'PENDING',
          amount: order.total,
          externalId: String(response.data.id),
          providerStatus: 'pending',
          statusDetail: null,
          paymentLink: paymentLink,
          pixCode: null,
          pixQrCodeUrl: null,
          expiresAt: null,
          paidAt: null,
        },
      });
    } catch (error: any) {
      console.error('[Mercado Pago Link Error]:', error.response?.data || error.message);
      throw new AppError('Erro ao gerar link de pagamento no Mercado Pago.', 500);
    }
  }

  // ==============================================================
  // 👉 3. PROCESSAR WEBHOOK (COM VALIDAÇÃO DE ASSINATURA)
  // ==============================================================
  async processWebhook(body: any, headers: any) {
    const type = body.type || body.topic || body.action;
    const paymentId = body.data?.id || body.resource;

    if (!['payment', 'payment.created', 'payment.updated'].includes(type) || !paymentId) return;

    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const signatureHeader = headers['x-signature'];
    const requestId = headers['x-request-id'];

    if (secret && (typeof signatureHeader !== 'string' || typeof requestId !== 'string')) {
      console.error('🚨 [Mercado Pago] Webhook sem assinatura rejeitado!');
      throw new AppError('Assinatura ausente ou malformada', 401);
    }

    if (secret && typeof signatureHeader === 'string' && typeof requestId === 'string') {
      const tsMatch = signatureHeader.match(/ts=(\d+)/);
      const v1Match = signatureHeader.match(/v1=([a-f0-9]{64})/i);

      if (!tsMatch || !v1Match) throw new AppError('Assinatura malformada', 401);

      const manifest = `id:${String(paymentId).trim()};request-id:${String(requestId).trim()};ts:${tsMatch[1]};`;
      const expectedHash = crypto.createHmac('sha256', secret).update(manifest).digest();
      const providedHash = Buffer.from(v1Match[1], 'hex');
      if (
        providedHash.length !== expectedHash.length ||
        !crypto.timingSafeEqual(providedHash, expectedHash)
      ) {
        throw new AppError('Assinatura inválida', 401);
      }
    }

    const deduplicationKey = crypto
      .createHash('sha256')
      .update(`${requestId ?? JSON.stringify(body)}:${type}:${paymentId}`)
      .digest('hex');
    const event = await prisma.paymentEvent.upsert({
      where: { deduplicationKey },
      create: {
        deduplicationKey,
        providerPaymentId: String(paymentId),
        type,
        payload: body,
      },
      update: {},
    });
    if (event.status === 'PROCESSED' || event.status === 'IGNORED') return;

    try {
      const idLimpo = mercadoPagoPaymentId(paymentId);
      if (!idLimpo) throw new AppError('Identificador de pagamento inválido.', 400);
      const result = await this.synchronizeProviderPayment(idLimpo);
      await prisma.paymentEvent.update({
        where: { id: event.id },
        data: {
          status: result ? 'PROCESSED' : 'IGNORED',
          ...(result?.paymentId ? { paymentId: result.paymentId } : {}),
          processedAt: new Date(),
          error: null,
        },
      });
    } catch (error: any) {
      await prisma.paymentEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
          processedAt: new Date(),
        },
      });
      console.error('[Mercado Pago Webhook Error]: Falha ao processar notificação', error.message);
      throw error;
    }
  }

  async reconcileOrderPayment(orderId: string, providerPaymentId?: string) {
    const payment = await prisma.payment.findUnique({ where: { orderId } });
    if (!payment || payment.status === 'PAID') return payment;
    const candidate = providerPaymentId || payment.externalId;
    if (!candidate || !/^\d+$/.test(candidate)) return payment;
    await this.synchronizeProviderPayment(candidate, orderId);
    return prisma.payment.findUnique({ where: { orderId } });
  }

  private async synchronizeProviderPayment(providerPaymentId: string, expectedOrderId?: string) {
    const mpResponse = await axiosStatic.get(`${this.baseUrl}/v1/payments/${providerPaymentId}`, {
      headers: this.headers(),
    });
    const paymentData = mpResponse.data as MercadoPagoPayment;
    const orderId = paymentData.external_reference;
    if (
      typeof orderId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) ||
      (expectedOrderId && expectedOrderId !== orderId)
    ) {
      throw new AppError('Referência externa inválida.', 400);
    }
    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!payment) throw new AppError('Pagamento do pedido não encontrado.', 404);
    if (paymentData.currency_id && paymentData.currency_id !== 'BRL') {
      throw new AppError('Moeda do pagamento inválida.', 400);
    }
    let receivedAmount: Prisma.Decimal;
    try {
      if (paymentData.transaction_amount === undefined) throw new Error('missing amount');
      receivedAmount = new Prisma.Decimal(paymentData.transaction_amount);
    } catch {
      throw new AppError('Valor do pagamento inválido.', 400);
    }
    if (!payment.amount.equals(receivedAmount)) {
      throw new AppError('Valor do pagamento divergente.', 400);
    }

    const mappedStatus = mapMercadoPagoStatus(paymentData.status, paymentData.status_detail);
    if (!mappedStatus) return null;
    if (
      mappedStatus === 'PAID' &&
      (payment.order.status === 'CANCELLED' || payment.order.status === 'REFUNDED')
    ) {
      throw new AppError('Pedido cancelado ou reembolsado não pode ser confirmado.', 409);
    }

    const firstPaidConfirmation = mappedStatus === 'PAID' && payment.status !== 'PAID';
    const updatedOrder = await prisma.$transaction(async (transaction) => {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: mappedStatus,
          externalId: String(paymentData.id),
          providerStatus: paymentData.status ?? null,
          statusDetail: paymentData.status_detail ?? null,
          webhookPayload: paymentData as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
          ...(mappedStatus === 'PAID' && {
            paidAt: paymentData.date_approved ? new Date(paymentData.date_approved) : new Date(),
          }),
        },
      });

      if (mappedStatus === 'REFUNDED' && payment.order.status !== 'REFUNDED') {
        return transaction.order.update({
          where: { id: orderId },
          data: {
            status: 'REFUNDED',
            statusHistory: {
              create: { status: 'REFUNDED', note: 'Pagamento reembolsado pelo Mercado Pago.' },
            },
          },
          include: {
            items: {
              include: { product: { select: { name: true } }, kit: { select: { name: true } } },
            },
          },
        });
      }
      if (firstPaidConfirmation && payment.order.status === 'PENDING') {
        return transaction.order.update({
          where: { id: orderId },
          data: {
            status: 'CONFIRMED',
            statusHistory: {
              create: { status: 'CONFIRMED', note: 'Pagamento confirmado pelo Mercado Pago.' },
            },
          },
          include: {
            items: {
              include: { product: { select: { name: true } }, kit: { select: { name: true } } },
            },
          },
        });
      }
      return transaction.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: { product: { select: { name: true } }, kit: { select: { name: true } } },
          },
        },
      });
    });

    if (firstPaidConfirmation && updatedOrder) {
      await this.publishPaymentConfirmation(payment.id, updatedOrder);
    }
    return { paymentId: payment.id, status: mappedStatus };
  }

  private async publishPaymentConfirmation(
    paymentId: string,
    order: NonNullable<Awaited<ReturnType<typeof prisma.order.findUnique>>> & {
      items: Array<{
        quantity: number;
        product: { name: string } | null;
        kit: { name: string } | null;
      }>;
    },
  ) {
    if (io) {
      io.to(`order_${order.id}`).emit('payment_confirmed', { orderId: order.id, status: 'PAID' });
      io.to('loja_fisica').emit('imprimir_cupom', {
        codigo: order.code,
        cliente: order.customerName,
        telefone: order.customerPhone,
        endereco: order.deliveryAddress || '>>> RETIRADA BALCÃO <<<',
        itens: order.items.map(
          (item) => `${item.quantity}x ${item.product?.name || item.kit?.name}`,
        ),
        total: order.total,
        data: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      });
    }

    const notification = await prisma.paymentNotification.upsert({
      where: {
        paymentId_type_channel: { paymentId, type: 'PAYMENT_CONFIRMED', channel: 'WHATSAPP' },
      },
      create: {
        paymentId,
        type: 'PAYMENT_CONFIRMED',
        channel: 'WHATSAPP',
        recipient: order.customerPhone,
      },
      update: { recipient: order.customerPhone },
    });
    if (notification.status === 'SENT') return;

    const whatsapp = new WhatsAppIntegrationService();
    const firstName = order.customerName.split(' ')[0] || 'Cliente';
    const templateName = process.env.META_PAYMENT_CONFIRMED_TEMPLATE?.trim();
    const result = templateName
      ? await whatsapp.sendTemplateMessage(order.customerPhone, templateName, [
          firstName,
          order.code,
        ])
      : await whatsapp.sendTextMessage(
          order.customerPhone,
          `Pagamento confirmado, ${firstName}! Recebemos o pagamento do pedido #${order.code}. Agora ele seguirá para preparação.`,
        );
    await prisma.paymentNotification.update({
      where: { id: notification.id },
      data: result.sent
        ? { status: 'SENT', sentAt: new Date(), error: null }
        : { status: 'FAILED', error: result.error },
    });
  }

  async getPaymentStatus(paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new AppError('Pagamento não encontrado.', 404);
    return payment;
  }

  // ==============================================================
  // 👉 4. TESTE RÁPIDO DE IMPRESSÃO (PÚBLICO)
  // ==============================================================
  async testPrint() {
    if (!io) throw new AppError('Socket.io não inicializado', 500);

    const cupomTeste = {
      codigo: `TESTE-${Math.floor(Math.random() * 10000)}`,
      cliente: 'Diego Nobre (Teste Nobre Labs)',
      telefone: '71999999999',
      endereco: '>>> RETIRADA BALCÃO <<<',
      itens: ['1x Whey Protein Isolado 900g - Teste', '2x Creatina 300g - Teste'],
      total: '199.90',
      data: new Date().toLocaleString('pt-BR'),
    };

    io.to('loja_fisica').emit('imprimir_cupom', cupomTeste);
    console.log(`[Teste de Impressão] 🖨️ Ordem de teste enviada para a loja física.`);

    return {
      message: 'Comando de impressão enviado com sucesso!',
      cupom: cupomTeste,
    };
  }
}
