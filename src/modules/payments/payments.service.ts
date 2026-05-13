import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import axiosStatic from 'axios';
import { io } from '../../shared/socket/socket.js';

export class PaymentsService {
  // ─── CREDENCIAIS SICREDI (VIA .ENV) ───────────────────────────
  private readonly clientId = process.env.SICREDI_CLIENT_ID!;
  private readonly clientSecret = process.env.SICREDI_CLIENT_SECRET!;
  private readonly chavePix = process.env.SICREDI_CHAVE_PIX!;
  private readonly baseUrl = process.env.SICREDI_BASE_URL || 'https://api-pix.sicredi.com.br';

  // ─── AGENTE DE SEGURANÇA (mTLS EXIGIDO PELO BANCO) ────────────
  private getHttpsAgent() {
    const certPath = process.env.SICREDI_CERT_PATH || './certs/certificado.pem';
    const keyPath = process.env.SICREDI_KEY_PATH || './certs/chave.pem';
    
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      throw new AppError('Certificados mTLS do Sicredi não encontrados na pasta /certs.', 500);
    }

    return new https.Agent({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      passphrase: process.env.SICREDI_CERT_PASSWORD || '', 
    });
  }

  // ─── OBTENÇÃO DE TOKEN OAUTH2 DO BANCO ───────────────────────
  private async getAccessToken(): Promise<string> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    try {
      const response = await axiosStatic.post(`${this.baseUrl}/oauth/token`, 'grant_type=client_credentials', {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: this.getHttpsAgent()
      });
      return response.data.access_token;
    } catch (error: any) {
      console.error('[Sicredi Auth Error]:', error.response?.data || error.message);
      throw new AppError('Falha ao autenticar com a API do Sicredi.', 500);
    }
  }

  // ==============================================================
  // 👉 1. GERAR PIX (COBRANÇA IMEDIATA)
  // ==============================================================
  async generatePix(orderId: string, email: string, name: string, cpf?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    const existingPayment = await prisma.payment.findFirst({
      where: { orderId, method: 'PIX', status: { in: ['PENDING', 'PAID'] } }
    });

    if (existingPayment?.pixCode) return existingPayment;

    const accessToken = await this.getAccessToken();
    const txid = crypto.randomBytes(16).toString('hex'); 
    const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : '00000000000'; 

    const payload = {
      calendario: { expiracao: 3600 },
      devedor: { cpf: cpfLimpo, nome: name },
      valor: { original: Number(order.total).toFixed(2) },
      chave: this.chavePix,
      solicitacaoPagador: `Pedido ${order.code} - Havoc Suplementos`
    };

    try {
      const response = await axiosStatic.put(`${this.baseUrl}/api/v2/cob/${txid}`, payload, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        httpsAgent: this.getHttpsAgent()
      });

      return await prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          method: 'PIX',
          amount: order.total,
          status: 'PENDING',
          externalId: response.data.txid,
          pixCode: response.data.pixCopiaECola,
          expiresAt: new Date(Date.now() + 3600 * 1000)
        },
        update: {
          method: 'PIX',
          status: 'PENDING',
          externalId: response.data.txid,
          pixCode: response.data.pixCopiaECola,
          expiresAt: new Date(Date.now() + 3600 * 1000)
        }
      });
    } catch (error: any) {
      console.error('[Sicredi Pix Error]:', error.response?.data || error.message);
      throw new AppError('Erro ao gerar PIX no Sicredi.', 500);
    }
  }

  // ==============================================================
  // 👉 2. GERAR LINK DE PAGAMENTO (BOLETO HÍBRIDO)
  // ==============================================================
  async generateLink(orderId: string) {
    // No Sicredi, o "Link" para o cliente geralmente é a visualização de um Boleto 
    // que já aceita PIX. Vamos usar a API de Cobrança com Boleto do Sicredi.
    
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Pedido não encontrado.', 404);

    const accessToken = await this.getAccessToken();

    // Nota: A estrutura de Boletos varia conforme a carteira do cliente no Sicredi.
    // Este é um exemplo da chamada de emissão de boleto.
    try {
      const response = await axiosStatic.post(`${this.baseUrl}/api/v1/boletos`, {
        pagador: { /* dados do cliente */ },
        valor: Number(order.total),
        dataVencimento: "2026-05-20", // Exemplo
        especieDocumento: "DM"
      }, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        httpsAgent: this.getHttpsAgent()
      });

      return prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          method: 'PAYMENT_LINK',
          amount: order.total,
          status: 'PENDING',
          externalId: response.data.nossoNumero,
          paymentLink: response.data.urlBoleto, // O "Link" que você queria!
        },
        update: {
          paymentLink: response.data.urlBoleto
        }
      });
    } catch (error: any) {
      // Se a conta do cliente não tiver Boletos ativos, vamos dar fallback para o PIX
      console.warn('⚠️ API de Boletos não configurada. Gerando PIX como alternativa de link.');
      return this.generatePix(orderId, 'email@exemplo.com', 'Cliente');
    }
  }

  // ==============================================================
  // 👉 3. PROCESSAR WEBHOOK (EXCLUSIVO SICREDI)
  // ==============================================================
  async processWebhook(body: any) {
    // O padrão do Banco Central (Sicredi incluído) envia um array "pix"
    if (!body.pix || !Array.isArray(body.pix)) return;

    for (const p of body.pix) {
      const payment = await prisma.payment.findFirst({
        where: { externalId: p.txid }
      });

      if (!payment || payment.status === 'PAID') continue;

      // 1. Atualiza Pagamento
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          paidAt: new Date(p.horario),
          webhookPayload: p
        }
      });

      // 2. Atualiza Pedido
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'CONFIRMED' }
      });

      // 3. Notifica via Socket
      if (io) {
        io.to(`order_${payment.orderId}`).emit('payment_confirmed', {
          orderId: payment.orderId,
          status: 'PAID'
        });
      }
    }
  }

  async getPaymentStatus(paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new AppError('Pagamento não encontrado.', 404);
    return payment;
  }
}