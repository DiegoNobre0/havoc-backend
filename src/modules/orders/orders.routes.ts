import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { 
  orderIdParamSchema, 
  orderQuerySchema, 
  updateOrderStatusSchema 
} from './orders.schemas.js';
import { OrderController } from './orders.controller.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';

export async function orderRoutes(app: FastifyInstance) {
  const controller = new OrderController();

  // Protege todas as rotas para que apenas o Lojista logado acesse
  app.addHook('onRequest', verifyJwt);

  // ==========================================
  // 📦 ROTAS DE PEDIDOS (ORDERS)
  // ==========================================
  
  app.withTypeProvider<ZodTypeProvider>().get('/', {
    schema: { 
      tags: ['Pedidos'], 
      summary: 'Lista todos os pedidos com paginação', 
      querystring: orderQuerySchema,
      security: [{ bearerAuth: [] }]
    }
  }, controller.list.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().get('/:id', {
    schema: { 
      tags: ['Pedidos'], 
      summary: 'Detalhes completos de um pedido (itens, cliente, pagamento e histórico)', 
      params: orderIdParamSchema,
      security: [{ bearerAuth: [] }]
    }
  }, controller.getById.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().patch('/:id/status', {
    schema: { 
      tags: ['Pedidos'], 
      summary: 'Atualiza o status do pedido e gera log no histórico', 
      params: orderIdParamSchema, 
      body: updateOrderStatusSchema,
      security: [{ bearerAuth: [] }]
    }
  }, controller.updateStatus.bind(controller));
}