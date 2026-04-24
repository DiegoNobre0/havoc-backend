import { FastifyRequest, FastifyReply } from 'fastify';
import { KitService } from './kit.service.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';
import { r2Client } from '../../../shared/lib/bucketR2.js';


export class KitController {
    private service = new KitService();

    async list(request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) {
        const { page, limit, search }: any = request.query;
        const data = await this.service.findMany(page, limit, search);
        return reply.send(data);
    }

    async create(request: FastifyRequest, reply: FastifyReply) {
        const data = await this.service.createKit(request.body as any);
        return reply.status(201).send(data);
    }

    async remove(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        await this.service.softDelete(request.params.id);
        return reply.status(204).send();
    }

    async uploadImage(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const data = await request.file();

        if (!data) return reply.status(400).send({ error: 'Nenhuma imagem enviada' });

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(data.mimetype)) {
            return reply.status(400).send({ error: 'Formato inválido. Envie JPG, PNG ou WEBP.' });
        }

        try {
            const imageBuffer = await data.toBuffer();

            const optimizedBuffer = await sharp(imageBuffer)
                .resize({ width: 800, withoutEnlargement: true })
                .webp({ quality: 80 })
                .toBuffer();

            const fileHash = crypto.randomBytes(8).toString('hex');
            // 👉 Salvamos na pasta "kits" do bucket
            const fileName = `kits/${request.params.id}-${fileHash}.webp`;

            await r2Client.send(
                new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: fileName,
                    Body: optimizedBuffer,
                    ContentType: 'image/webp',
                    CacheControl: 'public, max-age=31536000, immutable'
                })
            );

            const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

            // Salva a URL no banco de dados do Kit
            await this.service.update(request.params.id, {
                imageUrl: publicUrl,
                imageKey: fileName
            });

            return reply.send({
                message: 'Foto do Kit enviada com sucesso!',
                imageUrl: publicUrl
            });

        } catch (error) {
            console.error('Erro no upload de foto do kit para o R2:', error);
            return reply.status(500).send({ error: 'Falha interna ao processar a imagem do kit.' });
        }
    }
}