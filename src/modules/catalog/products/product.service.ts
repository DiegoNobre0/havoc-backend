import { prisma } from "../../../database/prisma.js";
import { redis } from "../../../shared/redis/redis.js";
import crypto from 'crypto';

export class ProductService {
  private CACHE_PREFIX = 'catalog:products:';

  // Helper para invalidar o cache sempre que houver alteração (POST, PUT, DELETE)
  private async clearCache() {
    const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
    if (keys.length > 0) await redis.del(keys);
  }

  async findMany(page: number, limit: number, search?: string, categoryId?: string) {
    const cacheKey = `${this.CACHE_PREFIX}page:${page}:limit:${limit}:search:${search || 'all'}:cat:${categoryId || 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };

    if (search) where.name = { contains: search, mode: 'insensitive' };
    
    // 👉 Busca produtos que tenham ALGUMA categoria com este ID
    if (categoryId) {
      where.categories = { some: { id: categoryId } };
    }

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: { categories: { select: { id: true, name: true } } }, // 👉 Retorna um Array agora
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const result = {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
    return result;
  }

async create(data: any) {
    const { categoryIds, ...rest } = data;
    
    // 1. Verifica se o slug já existe
    const existingProduct = await prisma.product.findUnique({
      where: { slug: rest.slug }
    });

    // 2. Se o slug existir, adiciona um hash curto para torná-lo único
    if (existingProduct) {
      const hash = crypto.randomBytes(3).toString('hex');
      rest.slug = `${rest.slug}-${hash}`;
    }

    const product = await prisma.product.create({ 
      data: {
        ...rest,
        categories: categoryIds ? { connect: categoryIds.map((id: string) => ({ id })) } : undefined
      } 
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
        // O "set" limpa as relações antigas e cria as novas
        categories: categoryIds ? { set: categoryIds.map((id: string) => ({ id })) } : undefined
      } 
    });
    await this.clearCache();
    return product;
  }

  async toggleStatus(id: string, isActive: boolean) {
    const product = await prisma.product.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true } // Retorna só o necessário
    });
    await this.clearCache();
    return product;
  }

  async softDelete(id: string) {
    const product = await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false }
    });
    await this.clearCache();
    return product;
  }
}