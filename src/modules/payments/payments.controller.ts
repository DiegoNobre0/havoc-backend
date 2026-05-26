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

    const actionType = body?.action || body?.type || body?.topic;

    if (
      actionType === 'payment.created' ||
      actionType === 'payment.updated' ||
      actionType === 'payment'
    ) {
      const paymentId = body?.data?.id || body?.resource;

      if (paymentId) {
        // ✅ Extrai APENAS os headers necessários para a validação
        // Evita problemas de serialização do objeto IncomingHttpHeaders completo
        const relevantHeaders = {
          'x-signature': (request.headers['x-signature'] as string) ?? null,
          'x-request-id': (request.headers['x-request-id'] as string) ?? null,
        };

        await paymentQueue.add(
          'process-mp-webhook',
          { body, headers: relevantHeaders },
          {
            removeOnComplete: true,
            removeOnFail: 50, // mantém os últimos 50 falhos para debug
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
      }
    }

    return reply.status(200).send('OK');
  }
}
