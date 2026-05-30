import { prisma } from '../../database/prisma.js';

export class OrderService {
  // 1. Lista os pedidos com paginação e busca
  // 1. Lista os pedidos com paginação e busca
  async listOrders(page: number, limit: number, search?: string, status?: any) {
    // 🔥 FORÇANDO A CONVERSÃO PARA NÚMERO (O Prisma exige que seja Int)
    const take = Number(limit) || 10;
    const skip = (Number(page) - 1) * take;
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        // Se a sua tabela User não tiver a coluna 'phone', você pode apagar a linha abaixo!
        { user: { phone: { contains: search } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          payment: true,
          // 👉 ADICIONE ESTE BLOCO PARA TRAZER OS ITENS E OS NOMES DOS PRODUTOS
          items: {
            include: {
              product: { select: { name: true } },
              kit: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return {
      data: orders,
      meta: { total, page: Number(page), limit: take, totalPages: Math.ceil(total / take) },
    };
  }

  // 2. Traz todos os detalhes do pedido para abrir na tela
  async getOrderById(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: true,
        payment: true,
        shippingRule: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        items: {
          include: {
            product: { select: { name: true, imageUrl: true } },
            kit: { select: { name: true, imageUrl: true } },
          },
        },
      },
    });

    if (!order) throw new Error('Pedido não encontrado.');
    return order;
  }

  // 3. Atualiza o status, gera o log automático e dispara notificações no WhatsApp
  async updateStatus(id: string, status: any, note?: string) {
    // 1. Atualiza o pedido no banco
    const order = await prisma.order.update({
      where: { id },
      data: {
        status,
        statusHistory: {
          create: {
            status,
            note: note || `Status alterado manualmente para ${status}`,
          },
        },
      },
    });

    // 🔥 2. SINCRONIZAÇÃO E NOTIFICAÇÕES VIA WHATSAPP 🔥
    try {
      if (order.customerPhone) {
        // Importação dinâmica para evitar dependência circular
        const ChatbotService = (await import('../chatbot/chatbot.service.js')).ChatbotService;
        const WhatsAppService = (
          await import('../../integrations/whatsapp/whatsappIntegration.service.js')
        ).WhatsAppIntegrationService;

        const chatbotService = new ChatbotService();
        const whatsapp = new WhatsAppService();

        const primeiroNome = order.customerName.split(' ')[0];
        const isDelivery = !!order.deliveryAddress;
        let mensagemAutomativa = '';

        // 👉 AVALIA O STATUS DO KANBAN PARA ENVIAR A MENSAGEM
        if (status === 'PROCESSING') {
          if (isDelivery) {
            mensagemAutomativa = `📦 Olá, ${primeiroNome}! O seu pedido *#${order.code}* acabou de ir para a fila de preparo. Logo mais ele sai para entrega! 🛵`;
          } else {
            mensagemAutomativa = `📦 Olá, ${primeiroNome}! O seu pedido *#${order.code}* já está sendo preparado. Avisaremos assim que estiver pronto para retirada! 🏃‍♂️`;
          }
        } else if (status === 'SHIPPED') {
          // Pedido saiu para entrega ou está pronto para retirar
          if (isDelivery) {
            mensagemAutomativa = `🛵 *SAIU PARA ENTREGA!*\nO motoboy já está a caminho com o seu pedido *#${order.code}*. Fique de olho aí! 👀`;
          } else {
            mensagemAutomativa = `✅ *PRONTINHO!*\nO seu pedido *#${order.code}* já está pronto e aguardando você aqui na loja. Pode vir retirar! 🛍️`;
          }
        }

        // Dispara a mensagem se o status bater com alguma das regras acima
        if (mensagemAutomativa) {
          await whatsapp.sendTextMessage(order.customerPhone, mensagemAutomativa);
          console.log(
            `[WhatsApp] 📲 Notificação de Rastreio (${status}) enviada para ${order.customerPhone}`,
          );

          // Salva essa mensagem do "Sistema" no histórico do chat para o atendente ver que foi enviado
          const session = await prisma.chatSession.findUnique({
            where: { sessionKey: order.customerPhone },
          });
          if (session) {
            await prisma.chatMessage.create({
              data: {
                sessionId: session.id,
                role: 'ASSISTANT',
                content: `[Rastreio Automático] ${mensagemAutomativa}`,
              },
            });
          }
        }

        // 👉 FINALIZAÇÃO DA SESSÃO (Amnésia da IA)
        let novoStatusChat: 'FINALIZADO' | 'CANCELADO' | null = null;
        if (status === 'DELIVERED') novoStatusChat = 'FINALIZADO';
        if (status === 'CANCELLED') novoStatusChat = 'CANCELADO';

        if (novoStatusChat) {
          const session = await prisma.chatSession.findUnique({
            where: { sessionKey: order.customerPhone },
          });
          if (session && session.status !== 'FINALIZADO' && session.status !== 'CANCELADO') {
            await chatbotService.updateSessionStatus(order.customerPhone, novoStatusChat);
            console.log(`[Sync] 🔄 Status do chat sincronizado para ${novoStatusChat}`);
          }
        }
      }
    } catch (error) {
      console.error(
        '[Sync Error] ⚠️ Erro ao sincronizar notificações do Kanban com WhatsApp:',
        error,
      );
    }

    return order;
  }
}
