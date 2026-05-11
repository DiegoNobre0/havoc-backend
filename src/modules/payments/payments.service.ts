import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import crypto from 'crypto';
import { io } from '../../shared/socket/socket.js';

export class PaymentsService {
  private readonly mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  private readonly webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  // ─── GERAR PIX ──────────────────────────────────────────────
  async generatePix(orderId: string, email: string, name: string, cpf?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    // Evita duplicidade se já houver um pagamento PENDING ou PAID
    const existingPayment = await prisma.payment.findFirst({
      where: { orderId, method: 'PIX', status: { in: ['PENDING', 'PAID'] } }
    });

    if (existingPayment?.pixCode) {
      return existingPayment; // Retorna o Pix já gerado
    }

    const payload = {
      transaction_amount: Number(order.total),
      description: `Pedido ${order.code} - Havoc Suplementos`,
      payment_method_id: 'pix',
      payer: {
        email,
        first_name: name.split(' ')[0],
        last_name: name.split(' ').slice(1).join(' ') || 'Havoc',
        // identification: { type: 'CPF', number: cpf || '00000000000' } // Descomente se sua conta MP exigir CPF
      },
      // notification_url: 'https://sua-api.com.br/payments/webhook' // Caso não tenha configurado no painel
    };

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.mpToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID() // Evita cobranças duplas na API deles
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[MP Pix Error]:', data);
      throw new AppError('Falha ao gerar o Pix no Mercado Pago.', 500);
    }

    // Salva ou atualiza no nosso banco
    return prisma.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        method: 'PIX',
        amount: order.total,
        status: 'PENDING',
        externalId: String(data.id),
        pixCode: data.point_of_interaction.transaction_data.qr_code,
        pixQrCodeUrl: data.point_of_interaction.transaction_data.qr_code_base64,
        expiresAt: new Date(data.date_of_expiration)
      },
      update: {
        method: 'PIX',
        status: 'PENDING',
        externalId: String(data.id),
        pixCode: data.point_of_interaction.transaction_data.qr_code,
        pixQrCodeUrl: data.point_of_interaction.transaction_data.qr_code_base64,
        expiresAt: new Date(data.date_of_expiration)
      }
    });
  }

  // ─── GERAR LINK DE PAGAMENTO (CHECKOUT PRO) ─────────────────
  async generateLink(orderId: string) {
    const order = await prisma.order.findUnique({ 
      where: { id: orderId },
      include: { items: { include: { product: true, kit: true } } } 
    });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    const items = order.items.map(item => ({
      title: item.product?.name || item.kit?.name || 'Item Havoc',
      quantity: item.quantity,
      unit_price: Number(item.unitPrice),
      currency_id: 'BRL'
    }));

    // Se houver frete, adiciona como item
    if (Number(order.shippingCost) > 0) {
      items.push({
        title: 'Frete',
        quantity: 1,
        unit_price: Number(order.shippingCost),
        currency_id: 'BRL'
      });
    }

    const payload = {
      items,
      external_reference: order.id, // O MP devolve isso no Webhook
      back_urls: {
        success: 'https://seu-front.com.br/orders/success',
        pending: 'https://seu-front.com.br/orders/pending',
        failure: 'https://seu-front.com.br/orders/failure'
      },
      auto_return: 'approved'
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.mpToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new AppError('Falha ao gerar link de pagamento.', 500);

    return prisma.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        method: 'PAYMENT_LINK',
        amount: order.total,
        status: 'PENDING',
        externalId: data.id,
        paymentLink: data.init_point, // Link que o cliente vai clicar
      },
      update: {
        method: 'PAYMENT_LINK',
        status: 'PENDING',
        externalId: data.id,
        paymentLink: data.init_point,
      }
    });
  }

  // ─── PROCESSAR WEBHOOK DO MERCADO PAGO ──────────────────────
  async processWebhook(paymentId: string) {
    // 1. Vai no Mercado Pago buscar os dados REAIS desse pagamento (Segurança máxima)
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${this.mpToken}` }
    });

    if (!response.ok) return; // Ignora se o ID for falso

    const data = await response.json();
    const orderId = data.external_reference || undefined; // Podemos ter passado o orderId aqui

    let statusMp = 'PENDING';
    if (data.status === 'approved') statusMp = 'PAID';
    if (data.status === 'cancelled' || data.status === 'rejected') statusMp = 'FAILED';

    // 2. Atualiza o banco de dados
    const payment = await prisma.payment.findFirst({
      where: { externalId: String(paymentId) } // Busca pelo ID do MP
    });

    if (!payment) return;

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: statusMp as any,
        paidAt: statusMp === 'PAID' ? new Date() : null,
        webhookPayload: data
      }
    });

    // 3. Atualiza o status do pedido se foi pago
    if (statusMp === 'PAID') {
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'CONFIRMED' }
      });

      await prisma.orderStatusHistory.create({
        data: {
          orderId: payment.orderId,
          status: 'CONFIRMED',
          note: 'Pagamento aprovado via Mercado Pago'
        }
      });

      if (io) {
        io.to(`order_${payment.orderId}`).emit('payment_confirmed', {
          orderId: payment.orderId,
          status: 'PAID',
          message: 'O pagamento foi confirmado com sucesso!'
        });
        console.log(`[Socket.io] 📢 Evento 'payment_confirmed' disparado para order_${payment.orderId}`);
      }
    }
  }

  // ─── BUSCAR STATUS DO PAGAMENTO ─────────────────────────────
  async getPaymentStatus(paymentId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      throw new AppError('Pagamento não encontrado.', 404);
    }

    return payment;
  }
}