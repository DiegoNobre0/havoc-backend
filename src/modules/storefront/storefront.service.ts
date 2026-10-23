import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { CatalogQuery } from './storefront.schemas.js';

const successfulOrderStatuses: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

const productSelect = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  name: true,
  slug: true,
  description: true,
  unit: true,
  price: true,
  price_wholesale: true,
  stock: true,
  sku: true,
  imageUrl: true,
  createdAt: true,
  categories: {
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  },
});

const productDetailSelect = Prisma.validator<Prisma.ProductSelect>()({
  ...productSelect,
  labelFacts: {
    select: {
      manufacturer: true,
      manufacturerDomain: true,
      sourceUrl: true,
      sourceTitle: true,
      sourceRetrievedAt: true,
      servingSize: true,
      servingsPerContainer: true,
      usageInstructions: true,
      ingredients: true,
      allergenStatement: true,
      warnings: true,
      nutritionFacts: true,
      status: true,
      exactProductMatch: true,
    },
  },
});

const kitSelect = Prisma.validator<Prisma.KitSelect>()({
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  discountType: true,
  discountValue: true,
  finalPrice: true,
  createdAt: true,
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      quantity: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          stock: true,
          unit: true,
          imageUrl: true,
          isActive: true,
          deletedAt: true,
          categories: {
            where: { isActive: true, deletedAt: null },
            select: { id: true, name: true, slug: true },
            orderBy: { name: 'asc' },
          },
        },
      },
    },
  },
});

type PublicProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
type PublicProductDetail = Prisma.ProductGetPayload<{ select: typeof productDetailSelect }>;
type PublicKit = Prisma.KitGetPayload<{ select: typeof kitSelect }>;

export class StorefrontService {
  private mapProduct(product: PublicProduct) {
    return {
      type: 'product' as const,
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      imageUrl: product.imageUrl,
      price: Number(product.price),
      available: product.stock > 0,
      categories: product.categories,
      createdAt: product.createdAt.toISOString(),
    };
  }

  private mapKit(kit: PublicKit) {
    const categories = new Map<
      string,
      (typeof kit.items)[number]['product']['categories'][number]
    >();

    for (const item of kit.items) {
      for (const category of item.product.categories) categories.set(category.id, category);
    }

    return {
      type: 'kit' as const,
      id: kit.id,
      name: kit.name,
      slug: kit.slug,
      description: kit.description,
      imageUrl: kit.imageUrl,
      price: Number(kit.finalPrice),
      available:
        kit.items.length > 0 &&
        kit.items.every(
          ({ product, quantity }) =>
            product.isActive && product.deletedAt === null && product.stock >= quantity,
        ),
      categories: [...categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
      createdAt: kit.createdAt.toISOString(),
    };
  }

  async getCatalog(query: CatalogQuery) {
    const { page, limit, search, categoryId, type } = query;
    const take = page * limit;
    const productWhere: Prisma.ProductWhereInput = {
      isActive: true,
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(categoryId && {
        categories: { some: { id: categoryId, isActive: true, deletedAt: null } },
      }),
    };
    const kitWhere: Prisma.KitWhereInput = {
      isActive: true,
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(categoryId && {
        items: {
          some: {
            product: {
              isActive: true,
              deletedAt: null,
              categories: { some: { id: categoryId, isActive: true, deletedAt: null } },
            },
          },
        },
      }),
    };

    const includeProducts = type !== 'kit';
    const includeKits = type !== 'product';
    const [productTotal, products, kitTotal, kits] = await Promise.all([
      includeProducts ? prisma.product.count({ where: productWhere }) : Promise.resolve(0),
      includeProducts
        ? prisma.product.findMany({
            where: productWhere,
            select: productSelect,
            take,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),
      includeKits ? prisma.kit.count({ where: kitWhere }) : Promise.resolve(0),
      includeKits
        ? prisma.kit.findMany({
            where: kitWhere,
            select: kitSelect,
            take,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),
    ]);

    const offset = (page - 1) * limit;
    const data = [
      ...products.map((product) => this.mapProduct(product)),
      ...kits.map((kit) => this.mapKit(kit)),
    ]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id) ||
          b.type.localeCompare(a.type),
      )
      .slice(offset, offset + limit);
    const total = productTotal + kitTotal;

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDetails(type: 'product' | 'kit', slug: string) {
    if (type === 'product') {
      const product = await prisma.product.findFirst({
        where: { slug, isActive: true, deletedAt: null },
        select: productDetailSelect,
      });
      if (!product) throw new AppError('Produto não encontrado.', 404);

      const label = (product as PublicProductDetail).labelFacts;
      const publicLabel =
        label?.status === 'SOURCE_MATCHED' &&
        label.exactProductMatch &&
        label.manufacturerDomain &&
        label.sourceUrl &&
        label.sourceRetrievedAt
          ? {
              manufacturer: label.manufacturer,
              manufacturerDomain: label.manufacturerDomain,
              servingSize: label.servingSize,
              servingsPerContainer: label.servingsPerContainer,
              usageInstructions: label.usageInstructions,
              ingredients: label.ingredients,
              allergenStatement: label.allergenStatement,
              warnings: label.warnings,
              nutritionFacts: label.nutritionFacts,
              source: {
                url: label.sourceUrl,
                title: label.sourceTitle,
                retrievedAt: label.sourceRetrievedAt.toISOString(),
              },
            }
          : null;

      return {
        ...this.mapProduct(product),
        unit: product.unit,
        sku: product.sku,
        priceWholesale: product.price_wholesale === null ? null : Number(product.price_wholesale),
        labelFacts: publicLabel,
      };
    }

    const kit = await prisma.kit.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      select: kitSelect,
    });
    if (!kit) throw new AppError('Kit não encontrado.', 404);

    return {
      ...this.mapKit(kit),
      originalPrice: kit.items.reduce(
        (total, item) => total + Number(item.product.price) * item.quantity,
        0,
      ),
      discountType: kit.discountType,
      discountValue: Number(kit.discountValue),
      items: kit.items.map(({ product, quantity }) => ({
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          unit: product.unit,
          imageUrl: product.imageUrl,
          price: Number(product.price),
          available: product.isActive && product.deletedAt === null && product.stock >= quantity,
        },
        quantity,
      })),
    };
  }

  async getCategories() {
    return prisma.category.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, slug: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  async getShippingRegions() {
    const rules = await prisma.shippingRule.findMany({
      where: {
        isActive: true,
        type: 'BY_REGION',
        region: { not: null },
      },
      select: { id: true, name: true, region: true, price: true, estimatedDays: true },
      orderBy: { region: 'asc' },
    });

    return rules.map((rule) => ({
      ...rule,
      region: rule.region!,
      price: Number(rule.price),
    }));
  }

  async getBestSellers(limit: number, period: '30d' | '90d' | 'all') {
    const since =
      period === 'all'
        ? undefined
        : new Date(Date.now() - Number.parseInt(period, 10) * 24 * 60 * 60 * 1000);
    let ranking = await this.buildSalesRanking(since);
    const fallbackApplied = period !== 'all' && ranking.length < limit;

    if (fallbackApplied) ranking = await this.buildSalesRanking();

    return {
      data: ranking.slice(0, limit),
      meta: { limit, period, fallbackApplied },
    };
  }

  private async buildSalesRanking(since?: Date) {
    const orderFilter: Prisma.OrderWhereInput = {
      status: { in: successfulOrderStatuses },
      deletedAt: null,
      ...(since && { createdAt: { gte: since } }),
    };
    const [productSales, kitSales] = await Promise.all([
      prisma.orderItem.groupBy({
        by: ['productId'],
        where: { productId: { not: null }, order: orderFilter },
        _sum: { quantity: true },
      }),
      prisma.orderItem.groupBy({
        by: ['kitId'],
        where: { kitId: { not: null }, order: orderFilter },
        _sum: { quantity: true },
      }),
    ]);
    const productQuantities = new Map(
      productSales.map((sale) => [sale.productId!, sale._sum.quantity ?? 0]),
    );
    const kitQuantities = new Map(kitSales.map((sale) => [sale.kitId!, sale._sum.quantity ?? 0]));
    const [products, kits] = await Promise.all([
      prisma.product.findMany({
        where: {
          id: { in: [...productQuantities.keys()] },
          isActive: true,
          deletedAt: null,
        },
        select: productSelect,
      }),
      prisma.kit.findMany({
        where: { id: { in: [...kitQuantities.keys()] }, isActive: true, deletedAt: null },
        select: kitSelect,
      }),
    ]);

    return [
      ...products.map((product) => ({
        ...this.mapProduct(product),
        soldQuantity: productQuantities.get(product.id) ?? 0,
      })),
      ...kits.map((kit) => ({
        ...this.mapKit(kit),
        soldQuantity: kitQuantities.get(kit.id) ?? 0,
      })),
    ].sort(
      (a, b) =>
        b.soldQuantity - a.soldQuantity ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
  }
}
