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
          gl: 'br', // Localização Brasil para resultados mais assertivos
          hl: 'pt', // Idioma Português
          num: 1, // Queremos apenas a primeira imagem
        }),
      });

      if (!serperResponse.ok) throw new Error('Falha na API do Serper. Verifique sua chave.');

      const serperData = await serperResponse.json();
      const imageUrl = serperData.images?.[0]?.imageUrl;

      if (!imageUrl) {
        console.log(`[Scraper] ⚠️ Nenhuma imagem encontrada no Google para: ${productName}`);
        return;
      }

      // 2. Faz o Download da Imagem direto da fonte original
      const imageResponse = await fetch(imageUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Pega o tipo da imagem (MimeType) que veio do site
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

      // 💡 O PULO DO GATO:
      // Criamos um "arquivo falso" (mock) imitando o formato que o Fastify envia.
      // Assim o seu StorageService processa a imagem original e faz o Sharp funcionar!
      const mockFile = {
        toBuffer: async () => buffer,
        mimetype: contentType,
      };

      // 3. Faz o Upload para o seu Bucket R2 via StorageService
      // Passamos o nome da pasta ('products') e o nosso falso arquivo
      const uploadResult = await storageService.uploadFile('products', mockFile);

      // 4. Atualiza o banco de dados com a URL oficial da sua nuvem
      await prisma.product.update({
        where: { id: productId },
        data: {
          imageUrl: uploadResult.url,
          imageKey: uploadResult.key, // Salvamos a chave também para você poder apagar do R2 no futuro!
        },
      });

      console.log(`[Scraper] ✅ Imagem processada pelo Sharp e salva no R2 para: ${productName}`);
    } catch (error) {
      console.error(`[Scraper] ❌ Erro ao buscar imagem para ${productName}:`, error);
    }
  },
  {
    connection: redis as any,
    concurrency: 1,
    lockDuration: 60000, // Aumenta o tempo de lock para 60 segundos (o padrão é 30s)
    lockRenewTime: 20000, // Renova o lock automaticamente a cada 20 segundos enquanto o job estiver rodando
  },
);
