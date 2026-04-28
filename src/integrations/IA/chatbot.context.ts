import { prisma } from '../../database/prisma.js';

export class ChatbotContext {
  
  // 1. Busca os Produtos e Categorias
  async getMenuContext(): Promise<string> {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      include: {
        products: {
          where: { isActive: true, stock: { gt: 0 } },
          select: { name: true, price: true, description: true }
        }
      }
    });

    if (categories.length === 0) return 'O catálogo está vazio no momento.';

    let menuText = '=== CATÁLOGO DE SUPLEMENTOS ===\n\n';
    categories.forEach(cat => {
      if (cat.products.length === 0) return;
      menuText += `[Categoria: ${cat.name}]\n`;
      cat.products.forEach(p => {
        menuText += `- ${p.name} (R$ ${Number(p.price).toFixed(2)})\n`;
        if (p.description) menuText += `  Detalhes: ${p.description}\n`;
      });
      menuText += '\n';
    });

    return menuText;
  }

  // 2. Busca os Kits Promocionais
  async getPromoKitsContext(): Promise<string> {
    const activeKits = await prisma.kit.findMany({
      where: { isActive: true },
      include: { items: { include: { product: { select: { name: true } } } } },
      take: 5 
    });

    if (activeKits.length === 0) return "Nenhum kit promocional ativo.";

    let text = "\n🔥 KITS PROMOCIONAIS IMPERDÍVEIS:\n";
    activeKits.forEach(kit => {
      const itemsList = kit.items.map(i => `${i.quantity}x ${i.product.name}`).join(', ');
      text += `- ✨ ${kit.name}: R$ ${Number(kit.finalPrice).toFixed(2)}\n`;
      text += `  Composição: ${itemsList}\n\n`;
    });

    return text;
  }

  // 3. Busca Pedidos do Cliente
  async getOrderStatus(phone: string): Promise<string> {
    // Aqui assumimos que o cliente é encontrado pelo telefone
    // Ajuste a busca conforme sua modelagem de Cliente/Pedido
    const orders = await prisma.order.findMany({
      where: { 
        client: { phone: phone }, // Supondo que Order tem relação com Client
        status: { notIn: ['DELIVERED', 'CANCELLED'] } 
      },
      select: { id: true, status: true, total: true }
    });

    if (orders.length === 0) return 'Você não possui pedidos em andamento no momento.';

    return orders.map(order => 
      `Pedido #${order.id.split('-')[0]} | Status: ${order.status} | Total: R$ ${Number(order.total).toFixed(2)}`
    ).join('\n');
  }
}