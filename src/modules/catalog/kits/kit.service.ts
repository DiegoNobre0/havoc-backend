import { prisma } from "../../../database/prisma.js";


interface KitCreateData {
    name: string;
    slug: string;
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    productItems: { productId: string; quantity: number }[];
}

export class KitService {

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
        // Incluímos os itens do kit e os dados básicos do produto para o Frontend
        include: { 
          items: { 
            include: { 
              product: { select: { name: true, price: true, imageUrl: true } } 
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
}