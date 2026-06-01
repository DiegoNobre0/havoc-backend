import dayjs from 'dayjs'; // Recomendo instalar: npm install dayjs
import { redis } from '../../shared/redis/redis.js';
import { prisma } from '../../database/prisma.js';

export class DashboardService {
  private readonly CACHE_TTL = 300; // 5 minutos de cache (300 segundos)

  // ==========================================
  // 1. RESUMO GERAL (KPIs)
  // ==========================================
  async getSummary() {
    const cacheKey = 'dashboard:summary:today';
    const cached = await redis.get(cacheKey);

    if (cached) return JSON.parse(cached);

    const todayStart = dayjs().startOf('day').toDate();
    const todayEnd = dayjs().endOf('day').toDate();

    const [ordersToday, revenueToday, pendingOrders, newCustomers] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),

      prisma.order.aggregate({
        _sum: { total: true },
        where: {
          createdAt: { gte: todayStart, lte: todayEnd },
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
        },
      }),

      prisma.order.count({ where: { status: 'PENDING' } }),

      // 👉 NOVO: Conta clientes criados hoje
      prisma.user.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, role: 'VISUALIZADOR' },
      }),
    ]);

    const result = {
      ordersToday,
      revenueToday: Number(revenueToday._sum.total || 0),
      pendingOrders,
      newCustomers, // 👉 NOVO
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);
    return result;
  }

  // ==========================================
  // 4. TOP PRODUTOS VENDIDOS
  // ==========================================
  async getTopProducts(limit = 5) {
    const cacheKey = `dashboard:top-products:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const topItems = await prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { quantity: 'desc' } },
      where: {
        productId: { not: null },
        order: {
          status: {
            in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'],
          },
        },
      },
      take: limit,
    });

    // Busca os nomes e categorias desses produtos
    const result = await Promise.all(
      topItems.map(async (item) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId! },
          include: { categories: { select: { name: true } } },
        });

        return {
          nome: product?.name || 'Produto Excluído',
          categoria: product?.categories[0]?.name || 'Sem Categoria',
          qtd: item._sum.quantity || 0,
          valor: Number(item._sum.totalPrice || 0),
        };
      }),
    );

    await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);
    return result;
  }
  // ==========================================
  // 2. RELATÓRIO DE VENDAS (Gráficos - CORRIGIDO)
  // ==========================================
  async getSalesReport(startDate?: Date, endDate?: Date) {
    const start = startDate || dayjs().subtract(7, 'days').toDate();
    const end = endDate || new Date();

    const cacheKey = `dashboard:sales:${start.toISOString()}:${end.toISOString()}`;
    const cached = await redis.get(cacheKey);

    if (cached) return JSON.parse(cached);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      },
      select: { total: true, createdAt: true },
    });

    const groupedData = orders.reduce((acc: Record<string, number>, order) => {
      // 👉 CORREÇÃO: Formata como YYYY-MM-DD para a ordenação matemática funcionar
      const dateKey = dayjs(order.createdAt).format('YYYY-MM-DD');

      if (!acc[dateKey]) acc[dateKey] = 0;
      acc[dateKey] += Number(order.total);

      return acc;
    }, {});

    // Ordena corretamente e mapeia para o ApexCharts
    const result = Object.entries(groupedData)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB)) // Agora ordena certo!
      .map(([date, revenue]) => ({
        date, // O frontend vai converter isso para DD/MM
        revenue,
      }));

    await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);
    return result;
  }

  // ==========================================
  // 3. PEDIDOS RECENTES (Paginação - CORRIGIDO)
  // ==========================================
  async getRecentOrders(page: number, limit: number, status?: any) {
    const skip = (page - 1) * limit;
    const whereClause = status ? { status } : {};

    const [total, orders] = await Promise.all([
      prisma.order.count({ where: whereClause }),
      prisma.order.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    const formattedOrders = orders.map((order: any) => ({
      id: order.id,
      code: order.code,
      // 👉 CORREÇÃO: Pega o nome do WhatsApp PRIMEIRO, se não tiver, pega do usuário logado
      customer: order.customerName || order.user?.name || 'Cliente Avulso (WhatsApp)',
      subtotal: Number(order.subtotal || 0),
      shippingCost: Number(order.shippingCost || 0),
      total: Number(order.total),
      status: order.status,
      itemsCount: order._count.items,
      createdAt: order.createdAt,
      endereco: order.deliveryAddress || 'Retirada na Loja',
    }));

    return {
      data: formattedOrders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
