
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
  async findSessions(page: number, limit: number, search?: string, status?: string) {
    const cacheKey = `${this.CACHE_PREFIX}page:${page}:limit:${limit}:search:${search || 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;
    const where: any = {};

    // Se houver busca, procura pelo número de telefone (sessionKey)
    if (search) {
      where.sessionKey = { contains: search };
    }

    if (status) {
      where.status = status; 
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
    // 1. Atualiza no PostgreSQL
    const session = await prisma.chatSession.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true, sessionKey: true }
    });

    // 2. 👉 A MÁGICA DO WORKER: Atualiza a sessão específica no Redis mantendo o carrinho!
    const workerRedisKey = `chat:session:${session.sessionKey}`;
    const sessionCache = await (redis as any).get(workerRedisKey);

    if (sessionCache) {
      const parsedSession = JSON.parse(sessionCache);
      parsedSession.isActive = isActive; // Atualiza só o status
      
      // Salva de volta (usando o TTL de 24h igual no Worker)
      await (redis as any).set(workerRedisKey, JSON.stringify(parsedSession), 'EX', 86400);
    }

    // 3. Limpa o cache da sua API (para a tela listar as conversas certo)
    if (this.clearCache) {
      await this.clearCache();
    }

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
  async updateSessionStatusById(id: string, status: any) {
    const session = await prisma.chatSession.update({
      where: { id },
      data: { status }
    });

    await this.clearCache();
    return session;
  }

  // Atualiza a Tag/Status da Sessão
  async updateSessionStatus(sessionKey: string, status: 'NOVO_ATENDIMENTO' | 'EM_ANDAMENTO' | 'AGUARDANDO_PAGAMENTO' | 'ATENDIMENTO_HUMANO' | 'FINALIZADO' | 'CANCELADO') {
    
    // 1. Atualiza no Prisma
    const session = await prisma.chatSession.update({
      where: { sessionKey },
      data: { 
        status,
        // 👉 SEGREDO: Se finalizou ou cancelou, devolvemos o controle pra IA automaticamente
        ...(status === 'FINALIZADO' || status === 'CANCELADO' ? { isActive: true } : {}) 
      }
    });

    // 2. Limpa o cache da listagem da API (o que você já tinha)
    if (this.clearCache) {
      await this.clearCache();
    }

    // 3. 👉 A AMNÉSIA: Se finalizou, limpa a memória da IA no Redis
    if (status === 'FINALIZADO' || status === 'CANCELADO') {
      const workerSessionKey = `chat:session:${sessionKey}`;
      const workerHistoryKey = `chat:history:${sessionKey}`;
      
      try {
        await (redis as any).del(workerSessionKey);
        await (redis as any).del(workerHistoryKey);
        console.log(`[Backend] 🧹 Memória da IA limpa para a sessão: ${sessionKey}`);
      } catch (err) {
        console.error(`[Backend] ⚠️ Erro ao limpar Redis do Worker para ${sessionKey}:`, err);
      }
    }

    return session;
  }

  // 👉 NOVO: Método específico para enviar mídias (Fotos, Áudios, Docs)
  async sendMediaMessage(sessionId: string, mediaUrl: string, mimeType: string, fileName: string) {
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error('Sessão não encontrada');

    let contentFormatado = '';

    // 1. Identifica o tipo e dispara via WhatsApp Cloud API
    if (mimeType.startsWith('image/')) {
      await this.whatsapp.sendImageMessage(session.sessionKey, mediaUrl);
      contentFormatado = `[IMG:${mediaUrl}]`;
    } 
    else if (mimeType.startsWith('audio/')) {
      // ⚠️ Certifique-se de ter o método sendAudioMessage no seu WhatsAppIntegrationService
      await this.whatsapp.sendAudioMessage(session.sessionKey, mediaUrl); 
      contentFormatado = `[AUDIO:${mediaUrl}]`;
    } 
    else {
      // ⚠️ Certifique-se de ter o método sendDocumentMessage no seu WhatsAppIntegrationService
      await this.whatsapp.sendDocumentMessage(session.sessionKey, mediaUrl, fileName);
      contentFormatado = `[DOC:${mediaUrl}] ${fileName}`;
    }

    // 2. Salva no banco com a Tag Mágica para o Frontend ler depois
    const newMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'ASSISTANT',
        content: contentFormatado
      }
    });

    await this.clearCache();
    return newMessage;
  }
}