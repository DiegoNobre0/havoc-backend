import { FastifyRequest, FastifyReply } from 'fastify';
import { ProductService } from './product.service.js';
import { StorageService } from '../../../shared/services/storage.service.js';
import { createProductSchema, updateProductSchema } from '../catalog.schemas.js';
import z from 'zod';

type CreateProductBody = z.infer<typeof createProductSchema>;
type UpdateProductBody = z.infer<typeof updateProductSchema>;

export class ProductController {
  private service = new ProductService();
  private storage = new StorageService();

  private mapBodyToProductData(body: CreateProductBody | UpdateProductBody) {
    const { stock_qty, category_ids, ...rest } = body;
    return {
      ...rest,
      ...(stock_qty !== undefined && { stock: stock_qty }),
      ...(category_ids !== undefined && { categoryIds: category_ids }),
    };
  }

  async list(request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) {
    const { page = 1, limit = 10, search, categoryId, isActive }: any = request.query;

    let parsedIsActive;
    if (isActive === 'true') parsedIsActive = true;
    else if (isActive === 'false') parsedIsActive = false;

    const data = await this.service.findMany(
      Number(page),
      Number(limit),
      search,
      categoryId,
      parsedIsActive,
    );

    return reply.send(data);
  }

  async create(request: FastifyRequest<{ Body: CreateProductBody }>, reply: FastifyReply) {
    try {
      const data = this.mapBodyToProductData(request.body);
      const product = await this.service.create(data);
      return reply.status(201).send(product);
    } catch (error) {
      console.error(error);
      return reply.status(500).send({ message: 'Erro ao criar produto.' });
    }
  }

  async update(
    request: FastifyRequest<{ Params: { id: string }; Body: UpdateProductBody }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const data = this.mapBodyToProductData(request.body);
      const product = await this.service.update(id, data);
      return reply.send(product);
    } catch (error) {
      console.error(error);
      return reply.status(500).send({ message: 'Erro ao atualizar produto.' });
    }
  }

  async remove(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.service.softDelete(request.params.id);
    return reply.status(204).send();
  }

  async importPDF(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ message: 'Nenhum PDF enviado.' });
      }

      const buffer = await data.toBuffer();

      const result = await this.service.importFromPDF(buffer);

      return reply.send({
        message: 'Inventário processado com sucesso!',
        resumo: result,
      });
    } catch (error) {
      console.error(error);
      return reply.status(500).send({ message: 'Erro interno ao processar o PDF.' });
    }
  }

  async uploadImage(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Arquivo ausente' });

    try {
      const { url, key } = await this.storage.uploadFile('products', file);

      await this.service.update(request.params.id, {
        imageUrl: url,
        imageKey: key,
      });

      return reply.send({ url });
    } catch (error) {
      return reply.status(500).send({ error: 'Erro no storage' });
    }
  }

  async toggleStatus(
    request: FastifyRequest<{ Params: { id: string }; Body: { isActive: boolean } }>,
    reply: FastifyReply,
  ) {
    const { isActive } = request.body;
    const data = await this.service.toggleStatus(request.params.id, isActive);
    return reply.send(data);
  }
}
