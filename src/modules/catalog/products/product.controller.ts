import { FastifyRequest, FastifyReply } from 'fastify';
import { ProductService } from './product.service.js';

import { StorageService } from '../../../shared/services/storage.service.js';


export class ProductController {
  private service = new ProductService();
  private storage = new StorageService();

  async list(request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) {
    const { page, limit, search, categoryId } : any= request.query;
    const data = await this.service.findMany(page, limit, search, categoryId);
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

  async uploadImage(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Arquivo ausente' });

    try {
      // Faz o upload usando o serviço universal na pasta 'products'
      const { url, key } = await this.storage.uploadFile('products', file);

      // Atualiza o produto com a URL retornada
      await this.service.update(request.params.id, { 
        imageUrl: url,
        imageKey: key 
      });

      return reply.send({ url });
    } catch (error) {
      return reply.status(500).send({ error: 'Erro no storage' });
    }
  }

  async toggleStatus(request: FastifyRequest<{ Params: { id: string }, Body: { isActive: boolean } }>, reply: FastifyReply) {
    const { isActive } = request.body;
    const data = await this.service.toggleStatus(request.params.id, isActive);
    return reply.send(data);
  }
}