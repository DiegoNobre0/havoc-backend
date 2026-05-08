
import { prisma } from '../../database/prisma.js';
import { WhatsAppIntegrationService } from '../../integrations/whatsapp/whatsappIntegration.service.js';
import { redis } from '../../shared/redis/redis.js';


export class ChatbotService {
  private CACHE_PREFIX = 'chatbot:sessions:';
  private whatsapp = new WhatsAppIntegrationService();

  // Invalida o cache sempre que o status mudar ou uma nova mensagem for enviada
  private async clearCache() {
    const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
    if (keys.length > 0) await redis.del(keys);
  }

  // 1. Busca todas as sessões (com paginação e cache)
  async findSessions(page: number, limit: number, search?: string) {
    const cacheKey = `${this.CACHE_PREFIX}page:${page}:limit:${limit}:search:${search || 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;
    const where: any = {};

    // Se houver busca, procura pelo número de telefone (sessionKey)
    if (search) {
      where.sessionKey = { contains: search };
    }

    const [total, sessions] = await Promise.all([
      prisma.chatSession.count({ where }),
      prisma.chatSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1 // Traz só a última mensagem para o preview
          }
        }
      })
    ]);

    const result = {
      data: sessions,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60); // Cache curto de 1 minuto para chat

    return result;

  }

  // 2. Detalhes de uma sessão específica
  async findSessionById(id: string) {
    return prisma.chatSession.findUnique({ where: { id } });
  }

  // 3. Histórico de mensagens (Não usamos cache aqui pois muda em tempo real)
  async findMessages(sessionId: string) {
    return prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' }
    });
  }

  // 4. Envia mensagem (Humano -> Cliente)
  async sendMessage(sessionId: string, content: string) {
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error('Sessão não encontrada');

    // Dispara via WhatsApp Cloud API
    await this.whatsapp.sendTextMessage(session.sessionKey, content);

    // Salva no banco como atendente (ASSISTANT)
    const newMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'ASSISTANT',
        content
      }
    });

    await this.clearCache();
    return newMessage;
  }

  // 5. Liga/Desliga a IA (Handoff)
  async toggleStatus(id: string, isActive: boolean) {
    const session = await prisma.chatSession.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true, sessionKey: true }
    });

    await this.clearCache();
    return session;
  }

  async getConfig() {
    let config = await prisma.chatbotConfig.findFirst();

    // Se não existir, cria o registro padrão (Seed automático)
    if (!config) {
      config = await prisma.chatbotConfig.create({
        data: {
          systemPrompt: 'Você é a Carol, consultora de vendas da Havoc Suplementos...',
          temperature: 0.7,
          maxTokens: 500,
          fallbackMessage: 'No momento estou processando muitas mensagens. Um humano já vai te atender!',
        }
      });
    }
    return config;
  }

  async updateConfig(data: any) { // Importe o UpdateConfigBody se quiser tipar
    const config = await this.getConfig(); // Garante que existe

    return prisma.chatbotConfig.update({
      where: { id: config.id },
      data,
    });
  }
}