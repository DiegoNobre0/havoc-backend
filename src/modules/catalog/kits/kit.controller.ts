import { FastifyRequest, FastifyReply } from 'fastify';
import { KitService } from './kit.service.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';
import { r2Client } from '../../../shared/lib/bucketR2.js';
import { StorageService } from '../../../shared/services/storage.service.js';


export class KitController {
    private service = new KitService();
    private storage = new StorageService();

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

    async update(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const data = await this.service.update(request.params.id, request.body as any);
        return reply.send(data);
    }


    async uploadImage(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const data = await request.file();

        if (!data) return reply.status(400).send({ error: 'Nenhuma imagem enviada' });

        // Validação inicial rápida
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(data.mimetype)) {
            return reply.status(400).send({ error: 'Formato inválido. Envie JPG, PNG ou WEBP.' });
        }

        try {            
            const uploadResult = await this.storage.uploadFile('kits', data); 
        
            await this.service.update(request.params.id, {
                imageUrl: uploadResult.url,
                imageKey: uploadResult.key
            });

            return reply.send({
                message: 'Foto do Kit enviada com sucesso!',
                imageUrl: uploadResult.url
            });

        } catch (error) {
            console.error('Erro no upload de foto do kit:', error);
            return reply.status(500).send({ error: 'Falha interna ao processar a imagem do kit.' });
        }
    }

    async toggleStatus(request: FastifyRequest<{ Params: { id: string }, Body: { isActive: boolean } }>, reply: FastifyReply) {
        const { isActive } = request.body;
        const data = await this.service.toggleStatus(request.params.id, isActive);
        return reply.send(data);
    }
}