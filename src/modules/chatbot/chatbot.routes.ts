import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { 
  idParamSchema, 
  sessionQuerySchema, 
  sendMessageSchema, 
  toggleStatusSchema, 
  updateConfigBodySchema
} from './chatbot.schemas.js';
import { ChatbotController } from './chatbot.controller.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';


export async function chatbotRoutes(app: FastifyInstance) {
  const controller = new ChatbotController();

  // Middleware de Autenticação (Protege as rotas para que só lojistas logados acessem)
  app.addHook('onRequest', verifyJwt);

  // ==========================================
  // 💬 ROTAS DE SESSÃO (CONVERSAS)
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().get('/sessions', {
    schema: { tags: ['Chatbot'], summary: 'Lista todas as sessões de chat', querystring: sessionQuerySchema }
  }, controller.listSessions.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().get('/sessions/:id', {
    schema: { tags: ['Chatbot'], summary: 'Detalhes de uma sessão', params: idParamSchema }
  }, controller.getSessionDetails.bind(controller));

  // ==========================================
  // ✉️ ROTAS DE MENSAGENS
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().get('/sessions/:id/messages', {
    schema: { tags: ['Chatbot'], summary: 'Histórico de mensagens de uma sessão', params: idParamSchema }
  }, controller.listMessages.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().post('/sessions/:id/messages', {
    schema: { tags: ['Chatbot'], summary: 'Envia mensagem como Atendente Humano', params: idParamSchema, body: sendMessageSchema }
  }, controller.sendMessage.bind(controller));

  // ==========================================
  // ⚙️ ROTAS DE CONTROLE (HANDOFF)
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().patch('/sessions/:id/status', {
    schema: { tags: ['Chatbot'], summary: 'Pausa/Retoma a Inteligência Artificial', params: idParamSchema, body: toggleStatusSchema }
  }, controller.toggleStatus.bind(controller));

  // Adicione junto das suas outras rotas
  app.withTypeProvider<ZodTypeProvider>().get('/config', {
    schema: { tags: ['Chatbot'], summary: 'Obtém as configurações atuais da IA', security: [{ bearerAuth: [] }] }
  }, controller.getConfig.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().put('/config', {
    schema: { tags: ['Chatbot'], summary: 'Atualiza o prompt e regras da IA', body: updateConfigBodySchema, security: [{ bearerAuth: [] }] }
  }, controller.updateConfig.bind(controller));
}