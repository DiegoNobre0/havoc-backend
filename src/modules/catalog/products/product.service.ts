import { prisma } from '../../../database/prisma.js';
import { redis } from '../../../shared/redis/redis.js';
import crypto from 'crypto';
import { imageScraperQueue } from '../../../shared/worker/image-scraper.worker.js';
import { IAService } from '../../../integrations/IA/IA.service.js';
import { PDFParse } from 'pdf-parse';
import { pdfImportItemSchema } from '../catalog.schemas.js';

export class ProductService {
  private CACHE_PREFIX = 'catalog:products:';
  private iaService = new IAService();

  private async clearCache() {
    const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
    if (keys.length > 0) await redis.del(keys);
  }

  async findMany(
    page: number,
    limit: number,
    search?: string,
    categoryId?: string,
    isActive?: boolean,
  ) {
    const cacheKey = `${this.CACHE_PREFIX}page:${page}:limit:${limit}:search:${search || 'all'}:cat:${categoryId || 'all'}:active:${isActive || 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };

    if (search) where.name = { contains: search, mode: 'insensitive' };

    if (categoryId) {
      where.categories = { some: { id: categoryId } };
    }

    if (isActive !== undefined) where.isActive = isActive;

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: { categories: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const result = {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
    return result;
  }

  async create(data: any) {
    const { categoryIds, ...rest } = data;

    const existingProduct = await prisma.product.findUnique({
      where: { slug: rest.slug },
    });

    if (existingProduct) {
      const hash = crypto.randomBytes(3).toString('hex');
      rest.slug = `${rest.slug}-${hash}`;
    }

    const product = await prisma.product.create({
      data: {
        ...rest,
        categories: categoryIds
          ? { connect: categoryIds.map((id: string) => ({ id })) }
          : undefined,
      },
    });

    await this.clearCache();
    return product;
  }

  async update(id: string, data: any) {
    const { categoryIds, ...rest } = data;
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...rest,
        categories: categoryIds ? { set: categoryIds.map((id: string) => ({ id })) } : undefined,
      },
    });
    await this.clearCache();
    return product;
  }

  async toggleStatus(id: string, isActive: boolean) {
    const product = await prisma.product.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });
    await this.clearCache();
    return product;
  }

  async softDelete(id: string) {
    const product = await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.clearCache();
    return product;
  }

  async importFromPDF(pdfBuffer: Buffer) {
    const parser = new PDFParse({ data: pdfBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const rawText = pdfData.text;

    const extractedProducts = await this.iaService.extractProductsFromPDF(rawText);

    const relatorio = {
      criados: 0,
      atualizados: 0,
      erros: 0,
      detalhesErros: [] as { item: unknown; motivo: string }[],
    };

    for (const rawItem of extractedProducts) {
      const parsed = pdfImportItemSchema.safeParse(rawItem);

      if (!parsed.success) {
        relatorio.erros++;
        relatorio.detalhesErros.push({
          item: rawItem,
          motivo: parsed.error.issues.map((i) => i.message).join('; '),
        });
        console.error(`Item inválido vindo da IA:`, rawItem, parsed.error.issues);
        continue;
      }

      const item = parsed.data;

      try {
        const slug = item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');

        // 🧠 MÁGICA DE MÚLTIPLAS CATEGORIAS: Busca ou cria todas as categorias/tags
        const categoryConnectIds: { id: string }[] = [];

        if (item.categories && item.categories.length > 0) {
          for (const catName of item.categories) {
            const cleanName = catName.trim();

            // Procura a categoria no banco
            let category = await prisma.category.findFirst({
              where: { name: { equals: cleanName, mode: 'insensitive' } },
            });

            // Se a IA inventou uma categoria/tag nova, a gente cria!
            if (!category) {
              category = await prisma.category.create({
                data: {
                  name: cleanName,
                  slug: cleanName
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)+/g, ''),
                  isActive: true,
                },
              });
            }
            // Guarda o ID para conectar no produto depois
            categoryConnectIds.push({ id: category.id });
          }
        }

        // 🔥 Lógica dinâmica de estoque
        const isProductActive = item.stock > 0;

        const existingProduct = await prisma.product.findFirst({
          where: {
            OR: [{ slug: slug }, { name: { equals: item.name, mode: 'insensitive' } }],
          },
        });

        if (existingProduct) {
          // ATUALIZA PRODUTO EXISTENTE
          await prisma.product.update({
            where: { id: existingProduct.id },
            data: {
              stock: item.stock,
              isActive: isProductActive, // 👈 Se for 0, desativa automaticamente; se for > 0, ativa.
              price: item.price,
              description: item.description || null, // 👈 Força null se vier undefined
              ...(item.cost !== undefined && { cost_price: item.cost }),
              ...(categoryConnectIds.length > 0 && { categories: { set: categoryConnectIds } }),
              updatedAt: new Date(),
            },
          });
          relatorio.atualizados++;
        } else {
          // CRIA PRODUTO NOVO
          const newProduct = await prisma.product.create({
            data: {
              name: item.name,
              slug: slug,
              price: item.price,
              description: item.description || null, // 👈 Força null se vier undefined
              ...(item.cost !== undefined && { cost_price: item.cost }),
              stock: item.stock,
              isActive: isProductActive, // 👈 Já nasce bloqueado se vier zerado do PDF
              ...(categoryConnectIds.length > 0 && { categories: { connect: categoryConnectIds } }),
            },
          });
          relatorio.criados++;

          // Manda pro caçador de imagens apenas se o produto entrar com estoque

          await imageScraperQueue.add('scrape-image', {
            productId: newProduct.id,
            productName: newProduct.name,
          });
        }
      } catch (err) {
        console.error(`Erro ao importar ${item.name}:`, err);
        relatorio.erros++;
        relatorio.detalhesErros.push({
          item,
          motivo: err instanceof Error ? err.message : 'Erro desconhecido ao gravar no banco',
        });
      }
    }

    await this.clearCache();
    return relatorio;
  }
}
