import { prisma } from '../../../database/prisma.js';
import { redis } from '../../../shared/redis/redis.js';
import crypto from 'crypto';
import { imageScraperQueue } from '../../../shared/worker/image-scraper.worker.js';
import { PDFParse } from 'pdf-parse';
import { pdfImportItemSchema } from '../catalog.schemas.js';
import { parseClippInventoryText } from './product-import.parser.js';
import { enrichImportedProducts } from './product-import.enrichment.js';

function normalizedCatalogName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function catalogSlug(value: string) {
  return normalizedCatalogName(value).replace(/\s+/g, '-');
}

export class ProductService {
  private CACHE_PREFIX = 'catalog:products:';

  private async clearCache() {
    const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
    if (keys.length > 0) await redis.del(keys);
  }

  async findMany(
    page: number = 1,
    limit: number = 2000,
    search?: string,
    categoryId?: string,
    isActive?: boolean,
  ) {
    // Garante conversão numérica para evitar NaN no skip
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 2000;

    const cacheKey = `${this.CACHE_PREFIX}page:${pageNum}:limit:${limitNum}:search:${search || 'all'}:cat:${categoryId || 'all'}:active:${isActive ?? 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (pageNum - 1) * limitNum;
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
        take: limitNum, // 👈 Usa o limite blindado
        include: {
          categories: { select: { id: true, name: true } },
          labelFacts: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const result = {
      data: products,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
    return result;
  }

  async create(data: any) {
    // 1. Extraímos o category_ids exato que veio do frontend
    const {
      category_ids,
      categoryIds,
      stock_qty,
      stock,
      manufacturer,
      manufacturerDomain,
      labelFacts,
      ...rest
    } = data;

    // Garantia dupla: pega a variável que estiver preenchida
    const catsToConnect = category_ids || categoryIds;

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
        stock: stock_qty ?? stock,
        categories: catsToConnect
          ? { connect: catsToConnect.map((id: string) => ({ id })) }
          : undefined,
        ...((manufacturer !== undefined ||
          manufacturerDomain !== undefined ||
          labelFacts !== undefined) && {
          labelFacts: { create: { manufacturer, manufacturerDomain, ...labelFacts } },
        }),
      },
    });

    await this.clearCache();
    return product;
  }

  async update(id: string, data: any) {
    const {
      category_ids,
      categoryIds,
      stock_qty,
      manufacturer,
      manufacturerDomain,
      labelFacts,
      ...rest
    } = data;
    const catsToConnect = category_ids || categoryIds;
    const storedLabel =
      manufacturer !== undefined || manufacturerDomain !== undefined
        ? await prisma.productLabel.findUnique({
            where: { productId: id },
            select: { manufacturer: true, manufacturerDomain: true },
          })
        : null;
    const sourceIdentityChanged =
      (manufacturer !== undefined && manufacturer !== storedLabel?.manufacturer) ||
      (manufacturerDomain !== undefined && manufacturerDomain !== storedLabel?.manufacturerDomain);
    const invalidateFacts = sourceIdentityChanged || labelFacts !== undefined;

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...rest,
        // Só atualiza o estoque se ele for enviado
        ...(stock_qty !== undefined && { stock: stock_qty }),

        // 👇 AQUI USA 'set' PARA SUBSTITUIR A LISTA DE CATEGORIAS
        categories: catsToConnect
          ? { set: catsToConnect.map((catId: string) => ({ id: catId })) }
          : undefined,
        ...((manufacturer !== undefined ||
          manufacturerDomain !== undefined ||
          labelFacts !== undefined) && {
          labelFacts: {
            upsert: {
              create: { manufacturer, manufacturerDomain, ...labelFacts },
              update: {
                ...(manufacturer !== undefined && { manufacturer }),
                ...(manufacturerDomain !== undefined && { manufacturerDomain }),
                ...labelFacts,
                ...(invalidateFacts && {
                  status: 'NOT_FOUND',
                  exactProductMatch: false,
                  version: { increment: 1 },
                }),
              },
            },
          },
        }),
      },
    });

    await this.clearCache();
    return product;
  }
  async findOne(id: string) {
    return prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { categories: true, labelFacts: true },
    });
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
    let rawText: string;
    try {
      rawText = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }

    const parsedPdf = parseClippInventoryText(rawText);
    const categories = await prisma.category.findMany({
      select: { id: true, name: true, slug: true, deletedAt: true },
    });
    const enrichmentBySku = await enrichImportedProducts(
      parsedPdf.items.map(({ sku, name }) => ({ sku, name })),
      categories.filter(({ deletedAt }) => deletedAt === null).map(({ name }) => name),
    );
    const categoriesByName = new Map<string, (typeof categories)[number]>();
    for (const category of categories) {
      const key = normalizedCatalogName(category.name);
      const current = categoriesByName.get(key);
      if (!current || (current.deletedAt && !category.deletedAt)) {
        categoriesByName.set(key, category);
      }
    }

    const relatorio = {
      criados: 0,
      atualizados: 0,
      semClassificacao: 0,
      erros: parsedPdf.errors.length,
      detalhesErros: parsedPdf.errors.map((error) => ({
        item: { sku: error.sku, registro: error.record },
        motivo: error.reason,
      })) as { item: unknown; motivo: string }[],
    };

    for (const extracted of parsedPdf.items) {
      const enrichment = enrichmentBySku.get(extracted.sku);
      const researchedCategories =
        enrichment && enrichment.confidence !== 'low'
          ? [enrichment.primaryCategory, enrichment.subtypeCategory].filter(
              (value): value is string => Boolean(value),
            )
          : [];
      if (researchedCategories.length === 0) relatorio.semClassificacao++;
      const rawItem = {
        ...extracted,
        ...(enrichment?.description ? { description: enrichment.description } : {}),
        categories: [...new Set(researchedCategories)],
      };
      const parsed = pdfImportItemSchema.safeParse(rawItem);

      if (!parsed.success) {
        relatorio.erros++;
        relatorio.detalhesErros.push({
          item: rawItem,
          motivo: parsed.error.issues.map((i) => i.message).join('; '),
        });
        console.error(`Item inválido extraído do PDF:`, rawItem, parsed.error.issues);
        continue;
      }

      const item = parsed.data;

      try {
        const slug = catalogSlug(item.name);
        const categoryConnectIds: { id: string }[] = [];

        for (const catName of item.categories) {
          const key = normalizedCatalogName(catName);
          if (!key) continue;
          let category = categoriesByName.get(key);
          if (category?.deletedAt) {
            category = await prisma.category.update({
              where: { id: category.id },
              data: { deletedAt: null, isActive: true },
              select: { id: true, name: true, slug: true, deletedAt: true },
            });
            categoriesByName.set(key, category);
          }
          if (!category) {
            const baseSlug = catalogSlug(catName);
            let categorySlug = baseSlug;
            let suffix = 2;
            while (categories.some((existing) => existing.slug === categorySlug)) {
              categorySlug = `${baseSlug}-${suffix++}`;
            }
            category = await prisma.category.create({
              data: { name: catName.trim(), slug: categorySlug, isActive: true },
              select: { id: true, name: true, slug: true, deletedAt: true },
            });
            categories.push(category);
            categoriesByName.set(key, category);
          }
          categoryConnectIds.push({ id: category.id });
        }

        const existingBySku = await prisma.product.findUnique({ where: { sku: item.sku } });
        const existingProduct =
          existingBySku ??
          (await prisma.product.findFirst({
            where: {
              deletedAt: null,
              OR: [{ slug }, { name: { equals: item.name, mode: 'insensitive' } }],
            },
          }));

        const isProductActive = item.stock > 0;
        if (existingProduct) {
          await prisma.product.update({
            where: { id: existingProduct.id },
            data: {
              sku: item.sku,
              stock: item.stock,
              isActive: isProductActive,
              deletedAt: null,
              price: item.price,
              ...(item.description !== undefined && { description: item.description }),
              ...(item.cost !== undefined && { cost_price: item.cost }),
              ...(categoryConnectIds.length > 0 && { categories: { set: categoryConnectIds } }),
              updatedAt: new Date(),
            },
          });
          relatorio.atualizados++;
        } else {
          const newProduct = await prisma.product.create({
            data: {
              sku: item.sku,
              name: item.name,
              slug,
              price: item.price,
              description: item.description ?? null,
              ...(item.cost !== undefined && { cost_price: item.cost }),
              stock: item.stock,
              isActive: isProductActive,
              ...(categoryConnectIds.length > 0 && { categories: { connect: categoryConnectIds } }),
            },
          });
          relatorio.criados++;

          if (isProductActive) {
            await imageScraperQueue
              .add('scrape-image', { productId: newProduct.id, productName: newProduct.name })
              .catch((error) =>
                console.error(`Erro ao enfileirar imagem de ${newProduct.name}:`, error),
              );
          }
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
