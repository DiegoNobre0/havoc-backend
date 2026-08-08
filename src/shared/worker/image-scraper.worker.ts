import { Worker, Queue } from 'bullmq';
import { prisma } from '../../database/prisma.js';
import { redis } from '../redis/redis.js';
import { StorageService } from '../services/storage.service.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// Instancia o seu serviço de Storage (Cloudflare R2 / AWS S3)
const storageService = new StorageService();

// Exporta a fila para o ProductService poder adicionar itens nela
export const imageScraperQueue = new Queue('image-scraper-queue', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 4, // O sistema vai tentar baixar a foto 4 vezes antes de desistir
    backoff: {
      type: 'exponential',
      delay: 5000, // Tempo de espera entre as tentativas (5s, 10s, 20s...)
    },
    removeOnComplete: true, // Limpa o Redis para não pesar a memória
    removeOnFail: false, // Deixa o erro no Redis caso você queira debugar depois
  },
});

console.log('📸 [Worker] Inicializando Caçador de Imagens (Serper.dev)...');

export const imageScraperWorker = new Worker(
  'image-scraper-queue',
  async (job) => {
    const { productId, productName } = job.data;

    try {
      if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY não configurada no .env');

      // 1. Busca a imagem no Google Imagens via Serper.dev
      const searchQuery = `${productName} suplemento pote fundo branco`;

      const serperResponse = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: searchQuery,
          gl: 'br',
          hl: 'pt',
          num: 5, // 🔥 Pede 5 opções para termos margem de erro
        }),
      });

      if (!serperResponse.ok) throw new Error('Falha na API do Serper. Verifique sua chave.');

      const serperData = await serperResponse.json();
      const imagens = serperData.images || [];

      if (imagens.length === 0) {
        console.log(`[Scraper] ⚠️ Nenhuma imagem encontrada no Google para: ${productName}`);
        return;
      }

      let bufferValido = null;
      let contentTypeValido = '';

      // 2. Loop de Segurança: Tenta baixar até encontrar um link que funcione
      for (const img of imagens) {
        try {
          // Pula imagens em base64 nativas do google
          if (img.imageUrl.startsWith('data:')) continue;

          // Adiciona timeout para não travar o worker em sites lentos
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const imageResponse = await fetch(img.imageUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!imageResponse.ok) continue; // Erro 403, 404, etc.

          // Valida se o arquivo baixado é realmente uma imagem e não um HTML de bloqueio
          const contentType = imageResponse.headers.get('content-type') || '';
          if (!contentType.startsWith('image/')) continue;

          const arrayBuffer = await imageResponse.arrayBuffer();
          bufferValido = Buffer.from(arrayBuffer);
          contentTypeValido = contentType;

          break; // Sucesso absoluto! Quebra o loop e segue o jogo.
        } catch (downloadError) {
          console.log(`[Scraper] Link falhou (${img.imageUrl}), tentando a próxima opção...`);
        }
      }

      if (!bufferValido) {
        console.log(`[Scraper] ❌ Todos os links falharam para: ${productName}`);
        return;
      }

      // 3. Faz o Upload com o arquivo 100% validado
      const mockFile = {
        toBuffer: async () => bufferValido,
        mimetype: contentTypeValido,
      };

      const uploadResult = await storageService.uploadFile('products', mockFile);

      // 4. Atualiza o banco
      await prisma.product.update({
        where: { id: productId },
        data: {
          imageUrl: uploadResult.url,
          imageKey: uploadResult.key,
        },
      });

      console.log(`[Scraper] ✅ Imagem blindada e salva no R2 para: ${productName}`);
    } catch (error) {
      console.error(`[Scraper] ❌ Erro crítico ao buscar imagem para ${productName}:`, error);
    }
  },
  {
    connection: redis as any,
    concurrency: 1,
    lockDuration: 60000,
    lockRenewTime: 20000,
  },
);
