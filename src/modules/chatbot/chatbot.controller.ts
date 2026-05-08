import { FastifyRequest, FastifyReply } from 'fastify';
import { ChatbotService } from './chatbot.service.js';

export class ChatbotController {
  private service = new ChatbotService();

  async listSessions(req: FastifyRequest<{ Querystring: { page: number; limit: number; search?: string } }>, reply: FastifyReply) {
    const { page, limit, search } = req.query;
    const result = await this.service.findSessions(page, limit, search);
    return reply.send(result);
  }

  async getSessionDetails(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const session = await this.service.findSessionById(id);
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' });
    return reply.send(session);
  }

  async listMessages(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const messages = await this.service.findMessages(id);
    return reply.send(messages);
  }

  async sendMessage(req: FastifyRequest<{ Params: { id: string }, Body: { content: string } }>, reply: FastifyReply) {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const message = await this.service.sendMessage(id, content);
      return reply.status(201).send(message);
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }

  async toggleStatus(req: FastifyRequest<{ Params: { id: string }, Body: { isActive: boolean } }>, reply: FastifyReply) {
    const { id } = req.params;
    const { isActive } = req.body;
    const session = await this.service.toggleStatus(id, isActive);
    return reply.send(session);
  }

  async getConfig(request: FastifyRequest, reply: FastifyReply) {
    const service = new ChatbotService(); // ou como você instanciou
    const config = await service.getConfig();
    return reply.send(config);
  }

  async updateConfig(request: FastifyRequest<{ Body: any }>, reply: FastifyReply) {
    const service = new ChatbotService();
    const config = await service.updateConfig(request.body);
    return reply.send({
      message: 'Configurações da IA atualizadas com sucesso!',
      config,
    });
  }
}