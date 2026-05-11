import { FastifyReply, FastifyRequest } from 'fastify';
import { PaymentsService } from './payments.service.js';
import { CreatePixBody, CreateLinkBody } from './payments.schemas.js';
import { paymentQueue } from '../../shared/worker/payment.queue.js';

export class PaymentsController {
  private service = new PaymentsService();

  async generatePix(request: FastifyRequest<{ Body: CreatePixBody }>, reply: FastifyReply) {
    const { orderId, email, name, cpf } = request.body;
    const payment = await this.service.generatePix(orderId, email, name, cpf);
    return reply.status(201).send(payment);
  }

  async generateLink(request: FastifyRequest<{ Body: CreateLinkBody }>, reply: FastifyReply) {
    const { orderId } = request.body;
    const payment = await this.service.generateLink(orderId);
    return reply.status(201).send(payment);
  }

  async checkStatus(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {    
    const payment = await this.service.getPaymentStatus(request.params.id);
    return reply.send(payment);
  }

  // ─── ROTA ABERTA PARA O MERCADO PAGO BATER ───
  async webhook(request: FastifyRequest, reply: FastifyReply) {
    const body: any = request.body;
    
    if (body?.action === 'payment.created' || body?.action === 'payment.updated') {
      const paymentId = body.data?.id;
      if (paymentId) {
        // 🔥 Joga para o BullMQ processar assincronamente 🔥
        await paymentQueue.add('process-mp-webhook', { paymentId }, {
          removeOnComplete: true,
          attempts: 3, // Se falhar, tenta de novo 3 vezes
          backoff: { type: 'exponential', delay: 2000 }
        });
      }
    }

    // Devolve 200 imediatamente para o MP não bloquear nossa API
    return reply.status(200).send('OK'); 
  }
}