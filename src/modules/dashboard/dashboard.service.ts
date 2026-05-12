
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
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] }
        }
      }),

      prisma.order.count({ where: { status: 'PENDING' } }),

      // 👉 NOVO: Conta clientes criados hoje
      prisma.user.count({ where: { createdAt: { gte: todayStart, lte: todayEnd }, role: 'VISUALIZADOR' } }) 
    ]);

    const result = {
      ordersToday,
      revenueToday: Number(revenueToday._sum.total || 0),
      pendingOrders,
      newCustomers // 👉 NOVO
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

    // Agrupa os itens de pedido pelo productId e soma as quantidades e valores
    const topItems = await prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { quantity: 'desc' } },
      where: { productId: { not: null } }, // Ignora itens que eram só de kits se houver
      take: limit
    });

    // Busca os nomes e categorias desses produtos
    const result = await Promise.all(topItems.map(async (item) => {
      const product = await prisma.product.findUnique({
        where: { id: item.productId! },
        include: { categories: { select: { name: true } } }
      });

      return {
        nome: product?.name || 'Produto Excluído',
        categoria: product?.categories[0]?.name || 'Sem Categoria',
        qtd: item._sum.quantity || 0,
        valor: Number(item._sum.totalPrice || 0)
      };
    }));

    await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);
    return result;
  }
  // ==========================================
  // 2. RELATÓRIO DE VENDAS (Gráficos)
  // ==========================================
  async getSalesReport(startDate?: Date, endDate?: Date) {
    const start = startDate || dayjs().subtract(7, 'days').toDate();
    const end = endDate || new Date();

    // Criamos uma chave de cache única baseada na data solicitada
    const cacheKey = `dashboard:sales:${start.toISOString()}:${end.toISOString()}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Busca todos os pedidos válidos no período
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] }
      },
      select: { total: true, createdAt: true }
    });

   // Tipamos explicitamente o acumulador (acc) e deixamos o TypeScript inferir o 'order' do Prisma
    const groupedData = orders.reduce((acc: Record<string, number>, order) => {
      const dateKey = dayjs(order.createdAt).format('DD-MM-YYYY');
      
      if (!acc[dateKey]) {
        acc[dateKey] = 0;
      }
      
      // Convertendo o objeto Decimal do Prisma para número nativo do JS na hora da soma
      acc[dateKey] += Number(order.total);
      
      return acc;
    }, {});
    // Formata para o ApexCharts: [{ date: '2026-04-20', revenue: 1500 }]
    const result = Object.entries(groupedData).map(([date, revenue]) => ({
      date,
      revenue
    })).sort((a, b) => a.date.localeCompare(b.date));

    await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);

    return result;
  }

  // ==========================================
  // 3. PEDIDOS RECENTES (Paginação)
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
          user: { select: { name: true, email: true } }, // Traz o nome do cliente
          _count: { select: { items: true } } // Traz a quantidade de itens no pedido
        }
      })
    ]);

    // Formata o retorno
    const formattedOrders = orders.map((order: any) => ({
      id: order.id,
      code: order.code,
      customer: order.user.name,
      total: Number(order.total),
      status: order.status,
      itemsCount: order._count.items,
      createdAt: order.createdAt
    }));

    return {
      data: formattedOrders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}