import { FastifyRequest, FastifyReply } from 'fastify';
import { OrderService } from './orders.service.js';

export class OrderController {
  private service = new OrderService();

  async list(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { page, limit, search, status } = req.query as any;
      const result = await this.service.listOrders(page, limit, search, status);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }

  async getById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const order = await this.service.getOrderById(id);
      return reply.send(order);
    } catch (error: any) {
      return reply.status(404).send({ error: error.message });
    }
  }

  async updateStatus(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const { status, note } = req.body as any;
      
      const updatedOrder = await this.service.updateStatus(id, status, note);
      return reply.send({ message: 'Status atualizado com sucesso', order: updatedOrder });
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }
}