import { FastifyRequest, FastifyReply } from 'fastify';
import { ProductService } from './product.service.js';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';
import { r2Client } from '../../../shared/lib/bucketR2.js';


export class ProductController {
  private service = new ProductService();

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
    const data = await request.file();
    
    if (!data) {
      return reply.status(400).send({ error: 'Nenhuma imagem enviada' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Formato inválido. Envie JPG, PNG ou WEBP.' });
    }

    try {
      // 1. Transforma o arquivo (Stream) num Buffer para o Sharp conseguir processar
      const imageBuffer = await data.toBuffer();

      // 2. Otimização Sênior: Converte tudo para WEBP (super leve e web friendly)
      const optimizedBuffer = await sharp(imageBuffer)
        .resize({ width: 800, withoutEnlargement: true }) // Redimensiona no máx para 800px
        .webp({ quality: 80 }) // Compacta em WebP com 80% de qualidade
        .toBuffer();

      // 3. Cria um nome único e seguro para o arquivo
      const fileHash = crypto.randomBytes(8).toString('hex');
      const fileName = `products/${request.params.id}-${fileHash}.webp`;

      // 4. Envia para o Cloudflare R2
      await r2Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: fileName,
          Body: optimizedBuffer,
          ContentType: 'image/webp',
          // Opcional: Cache-Control para o navegador do cliente não ficar baixando a imagem toda hora
          CacheControl: 'public, max-age=31536000, immutable' 
        })
      );

      // 5. Monta a URL pública (usando a variável de ambiente)
      const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

      // 6. Atualiza o banco de dados com a nova URL (e a Key para deleção futura)
      await this.service.update(request.params.id, { 
        imageUrl: publicUrl,
        imageKey: fileName // Salvamos a chave para quando formos apagar o produto, apagar do bucket também
      });

      return reply.send({ 
        message: 'Upload otimizado concluído com sucesso!', 
        imageUrl: publicUrl 
      });

    } catch (error) {
      console.error('Erro no upload para o R2:', error);
      return reply.status(500).send({ error: 'Falha interna ao processar a imagem.' });
    }
  }
}