import { FastifyRequest, FastifyReply } from 'fastify';
import { ShippingService } from './shipping.service.js';


export class ShippingController {
  private service = new ShippingService();

  async listRules(req: FastifyRequest, reply: FastifyReply) {
    const rules = await this.service.listAll();
    return reply.send(rules);
  }

  async createRule(req: FastifyRequest, reply: FastifyReply) {
    const rule = await this.service.create(req.body);
    return reply.status(201).send(rule);
  }

  async updateRule(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const rule = await this.service.update(req.params.id, req.body);
    return reply.send(rule);
  }

  async deleteRule(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.service.delete(req.params.id);
    return reply.status(204).send();
  }
}