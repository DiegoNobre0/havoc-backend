import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2Client } from '../lib/bucketR2.js';
import sharp from 'sharp';
import crypto from 'crypto';

export class StorageService {
  private bucketName = process.env.R2_BUCKET_NAME;
  private publicUrl = process.env.R2_PUBLIC_URL;

  /**
   * Upload Universal: Detecta o tipo e processa conforme necessário
   * @param folder Pasta de destino (products, avatars, docs)
   * @param file O arquivo vindo do Fastify-Multipart
   */
  async uploadFile(folder: string, file: any) {
    const fileBuffer = await file.toBuffer();
    const fileHash = crypto.randomBytes(8).toString('hex');
    const extension = file.mimetype.split('/')[1];
    
    let finalBuffer = fileBuffer;
    let fileName = `${folder}/${fileHash}-${Date.now()}.${extension}`;
    let contentType = file.mimetype;

    // ⚡ Otimização de Imagens (Opcional - Apenas se for imagem)
    if (file.mimetype.startsWith('image/') && !file.mimetype.includes('gif')) {
      finalBuffer = await sharp(fileBuffer)
        .resize({ width: 1000, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      
      fileName = `${folder}/${fileHash}-${Date.now()}.webp`;
      contentType = 'image/webp';
    }

    // Envio para o R2
    await r2Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: finalBuffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );

    return {
      url: `${this.publicUrl}/${fileName}`,
      key: fileName
    };
  }

  async deleteFile(key: string) {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })
    );
  }
}