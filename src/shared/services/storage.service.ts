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
    const originalExtension = file.mimetype.split('/')[1];
    
    let finalBuffer = fileBuffer;
    let fileName = `${folder}/${fileHash}-${Date.now()}.${originalExtension}`;
    let contentType = file.mimetype;

    // ⚡ Otimização de Imagens (Opcional - Apenas se for imagem)
    if (file.mimetype.startsWith('image/') && !file.mimetype.includes('gif')) {
      
      // 👇 Verifica se é PNG para manter a transparência, senão vira JPG
      const isPng = file.mimetype === 'image/png';
      const finalExt = isPng ? 'png' : 'jpg';
      contentType = isPng ? 'image/png' : 'image/jpeg';

      finalBuffer = await sharp(fileBuffer)
        .resize({ width: 1000, withoutEnlargement: true })
        .toFormat(isPng ? 'png' : 'jpeg', { quality: 80 })
        .toBuffer();
      
      fileName = `${folder}/${fileHash}-${Date.now()}.${finalExt}`;
    }

    // Envio para o R2
    await r2Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName, // Certifique-se que this.bucketName está acessível aqui
        Key: fileName,
        Body: finalBuffer,
        ContentType: contentType, // Usa o formato certinho pro WhatsApp ler
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );

    return {
      url: `${this.publicUrl}/${fileName}`, // Certifique-se que this.publicUrl está acessível
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