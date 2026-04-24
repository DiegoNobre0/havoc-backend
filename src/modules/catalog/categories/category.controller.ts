import { FastifyRequest, FastifyReply } from 'fastify';
import { CategoryService } from './category.service.js';


export class CategoryController {
  private service = new CategoryService();

  async list(request: FastifyRequest, reply: FastifyReply) {
    const data = await this.service.findAll();
    return reply.send(data);
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = await this.service.create(request.body as any);
    return reply.status(201).send(data);
  }

  async update(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const data = await this.service.update(request.params.id, request.body as any);
    return reply.send(data);
  }

  async remove(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.service.softDelete(request.params.id);
    return reply.status(204).send();
  }
}