import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import axiosStatic from 'axios';
import { io } from '../../shared/socket/socket.js';
import crypto from 'crypto';

export class PaymentsService {
  // ─── CREDENCIAIS MERCADO PAGO (VIA .ENV) ───────────────────────────
  // No seu .env, adicione: MERCADO_PAGO_ACCESS_TOKEN=APP_USR-12345...
  private readonly accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN!;
  private readonly baseUrl = 'https://api.mercadopago.com';

  // Helper para injetar o header de autenticação em todas as requisições
  private get headers() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      // Opcional: Adiciona um id de idempotência para evitar cobranças duplicadas em falhas de rede
      'X-Idempotency-Key': crypto.randomUUID(),
    };
  }

  // ==============================================================
  // 👉 1. GERAR PIX (COBRANÇA IMEDIATA COM COPIA E COLA)
  // ==============================================================
  async generatePix(orderId: string, email: string, name: string, cpf?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    const existingPayment = await prisma.payment.findFirst({
      where: { orderId, method: 'PIX', status: { in: ['PENDING', 'PAID'] } },
    });

    if (existingPayment?.pixCode) return existingPayment;

    // O MP exige um e-mail. Se for pedido via WhatsApp sem cadastro, usamos um fallback
    const payerEmail = email && email.includes('@') ? email : 'cliente@havocsuplementos.shop';
    const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : null;

    const payload = {
      transaction_amount: Number(order.total),
      description: `Pedido ${order.code} - Havoc Suplementos`,
      payment_method_id: 'pix',
      external_reference: orderId, // Crucial para vincular o webhook depois
      // 🔥 A TRAVA AQUI: Força o MP a responder nesta exata URL
      notification_url: 'https://api.havocsuplementos.shop/payments/webhook',
      payer: {
        email: payerEmail,
        first_name: name,
        ...(cpfLimpo && { identification: { type: 'CPF', number: cpfLimpo } }),
      },
    };

    try {
      const response = await axiosStatic.post(`${this.baseUrl}/v1/payments`, payload, {
        headers: this.headers,
      });

      const paymentData = response.data;
      const pixCode = paymentData.point_of_interaction?.transaction_data?.qr_code;

      return await prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          method: 'PIX',
          amount: order.total,
          status: 'PENDING',
          externalId: String(paymentData.id),
          pixCode: pixCode,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // PIX expira em 30 min por padrão no MP
        },
        update: {
          method: 'PIX',
          status: 'PENDING',
          externalId: String(paymentData.id),
          pixCode: pixCode,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
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
  async generateLink(orderId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

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
      // 🔥 A TRAVA AQUI TAMBÉM: Webhook garantido
      notification_url: 'https://api.havocsuplementos.shop/payments/webhook',
      // Redireciona o cliente de volta pro seu site após pagar
      back_urls: {
        success: 'https://wa.me/5571981214680?text=Acabei%20de%20pagar%20no%20cartão!',
        pending: 'https://wa.me/5571981214680?text=Meu%20pagamento%20tá%20em%20análise',
        failure: 'https://wa.me/5571981214680?text=Deu%20erro%20no%20meu%20cartão,%20me%20ajuda',
      },
      auto_return: 'approved',
    };

    try {
      const response = await axiosStatic.post(`${this.baseUrl}/checkout/preferences`, payload, {
        headers: this.headers,
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
          paymentLink: paymentLink,
        },
        update: {
          paymentLink: paymentLink,
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
    const type = body.type || body.topic;
    const paymentId = body.data?.id || body.resource;

    if (type !== 'payment' || !paymentId) return;

    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const signatureHeader = headers['x-signature'];
    const requestId = headers['x-request-id'];

    if (secret && (!signatureHeader || !requestId)) {
      console.error('🚨 [Mercado Pago] Webhook sem assinatura rejeitado!');
      throw new AppError('Assinatura ausente', 401);
    }

    if (secret && signatureHeader && requestId) {
      const tsMatch = signatureHeader.match(/ts=(\d+)/);
      const v1Match = signatureHeader.match(/v1=([a-f0-9]+)/);

      if (tsMatch && v1Match) {
        const ts = tsMatch[1];
        const hash = v1Match[1];

        // ✅ Garante string pura — número vira "160291108545", não muda nada
        const idStr = String(paymentId).trim();
        const reqId = String(requestId).trim();

        const manifest = `id:${idStr};request-id:${reqId};ts:${ts};`;

        const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

        if (hmac !== hash) {
          console.error('🚨 [Mercado Pago] Assinatura inválida!');
          console.error(`  → manifest: ${manifest}`);
          console.error(`  → esperado: ${hash}`);
          console.error(`  → calculado: ${hmac}`);
          throw new AppError('Assinatura inválida', 401);
        }
      }
    }

    try {
      // 🛡️ TRAVA 2: CONFIRMAÇÃO DIRETA NA API (Dupla Checagem)
      const idLimpo = String(paymentId).replace(/\D/g, '');

      const mpResponse = await axiosStatic.get(`${this.baseUrl}/v1/payments/${idLimpo}`, {
        headers: this.headers,
      });

      const paymentData = mpResponse.data;

      if (paymentData.status !== 'approved') return;

      const orderId = paymentData.external_reference;
      const payment = await prisma.payment.findFirst({ where: { orderId: orderId } });

      if (!payment || payment.status === 'PAID') return;

      // 1. Atualiza Pagamento
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          paidAt: new Date(paymentData.date_approved),
          webhookPayload: paymentData,
        },
      });

      // 2. Atualiza Pedido E TRÁS OS DADOS PARA O CUPOM
      const updatedOrder = await prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'CONFIRMED' },
        include: {
          items: {
            include: { product: { select: { name: true } }, kit: { select: { name: true } } },
          },
        },
      });

      // 3. Notificações e Impressão
      if (io) {
        io.to(`order_${payment.orderId}`).emit('payment_confirmed', {
          orderId: payment.orderId,
          status: 'PAID',
        });

        const cupom = {
          codigo: updatedOrder.code,
          cliente: updatedOrder.customerName,
          telefone: updatedOrder.customerPhone,
          endereco: updatedOrder.deliveryAddress || '>>> RETIRADA BALCÃO <<<',
          itens: updatedOrder.items.map((i) => `${i.quantity}x ${i.product?.name || i.kit?.name}`),
          total: updatedOrder.total,
          data: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        };

        io.to('loja_fisica').emit('imprimir_cupom', cupom);
        console.log(`[Impressão MP] 🖨️ Ordem enviada para a loja: Pedido ${updatedOrder.code}`);
      }
    } catch (error: any) {
      console.error('[Mercado Pago Webhook Error]: Falha ao processar notificação', error.message);
    }
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
