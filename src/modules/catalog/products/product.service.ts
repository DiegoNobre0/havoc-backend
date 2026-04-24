import { prisma } from "../../../database/prisma.js";
import { redis } from "../../../shared/redis/redis.js";

export class ProductService {
  private CACHE_PREFIX = 'catalog:products:';

  // Helper para invalidar o cache sempre que houver alteração (POST, PUT, DELETE)
  private async clearCache() {
    const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
    if (keys.length > 0) await redis.del(keys);
  }

  async findMany(page: number, limit: number, search?: string, categoryId?: string) {
    // 1. Gera uma chave de cache única baseada nos filtros
    const cacheKey = `${this.CACHE_PREFIX}page:${page}:limit:${limit}:search:${search || 'all'}:cat:${categoryId || 'all'}`;
    const cached = await redis.get(cacheKey);

    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;

    // 2. Monta os filtros dinamicamente
    const where: any = { deletedAt: null }; // Apenas não deletados
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // 3. Executa a busca paginada
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: { category: { select: { name: true } } }, // Traz o nome da categoria
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const result = {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };

    // 4. Salva no Redis (TTL de 10 minutos para vitrine)
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);

    return result;
  }

  async create(data: any) {
    const product = await prisma.product.create({ data });
    await this.clearCache(); // Invalida o cache!
    return product;
  }

  async update(id: string, data: any) {
    const product = await prisma.product.update({ where: { id }, data });
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