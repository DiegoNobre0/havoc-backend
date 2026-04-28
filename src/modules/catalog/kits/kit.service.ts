import { prisma } from "../../../database/prisma.js";
import { redis } from "../../../shared/redis/redis.js";


interface KitCreateData {
    name: string;
    slug: string;
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    productItems: { productId: string; quantity: number }[];
}

export class KitService {
 private CACHE_PREFIX = 'catalog:kits:';
  private async clearCache() {
      const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) await redis.del(keys);
    }

async findMany(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [total, kits] = await Promise.all([
      prisma.kit.count({ where }),
      prisma.kit.findMany({
        where,
        skip,
        take: limit,
        // Mergulhando nos relacionamentos: Kit -> Itens -> Produto -> Categorias
        include: { 
          items: { 
            include: { 
              product: { 
                select: { 
                  id: true, // Sempre bom retornar o ID
                  name: true, 
                  price: true, 
                  imageUrl: true,
                  // 👉 Trazendo as categorias do produto
                  categories: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                } 
              } 
            } 
          } 
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return {
      data: kits,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };
  }

    async createKit(data: KitCreateData) {
        // 1. Busca os preços originais dos produtos
        const productIds = data.productItems.map(item => item.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds }, deletedAt: null }
        });

        if (products.length !== productIds.length) {
            throw new Error('Um ou mais produtos informados não existem ou foram removidos.');
        }

        // 2. Calcula o Subtotal base (Quantidade x Preço Unitário)
        let subtotal = 0;
        data.productItems.forEach(item => {
            const product = products.find((p: any) => p.id === item.productId);
            if (product) {
                subtotal += Number(product.price) * item.quantity;
            }
        });

        // 3. Calcula o Preço Final aplicando o desconto
        let finalPrice = subtotal;
        if (data.discountType === 'PERCENTAGE') {
            finalPrice = subtotal - (subtotal * (data.discountValue / 100));
        } else if (data.discountType === 'FIXED') {
            finalPrice = subtotal - data.discountValue;
        }

        // 4. Cria o Kit e os Itens do Kit em uma única Transação
        return prisma.kit.create({
            data: {
                name: data.name,
                slug: data.slug,
                discountType: data.discountType,
                discountValue: data.discountValue,
                finalPrice: finalPrice,
                items: {
                    create: data.productItems.map(item => ({
                        productId: item.productId,
                        quantity: item.quantity
                    }))
                }
            },
            include: { items: { include: { product: true } } }
        });
    }

    // Soft Delete do Kit
    async softDelete(id: string) {
        return prisma.kit.update({
            where: { id },
            data: { deletedAt: new Date(), isActive: false }
        });
    }


    async update(id: string, data: any) {
    return prisma.kit.update({
      where: { id },
      data
    });
  }

  async toggleStatus(id: string, isActive: boolean) {
    const kit = await prisma.kit.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true } // Retorna só o essencial para economizar banda
    });
    await this.clearCache(); // Se você estiver usando Redis para kits, lembre de limpar aqui!
    return kit;
  }
}