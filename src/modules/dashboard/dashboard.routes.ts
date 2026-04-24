import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DashboardController } from './dashboard.controller.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';
import { dashboardQuerySchema, paginationQuerySchema } from './dashboard.schema.js';


const dashboardController = new DashboardController();

export async function dashboardRoutes(app: FastifyInstance) {
  // O app.addHook garante que todas as rotas de dashboard exijam o Token JWT!
  app.addHook('onRequest', verifyJwt);

  app.withTypeProvider<ZodTypeProvider>().get('/summary', {
    schema: { tags: ['Dashboard'], summary: 'Retorna KPIs gerais (Cache via Redis)' }
  }, dashboardController.summary);

  app.withTypeProvider<ZodTypeProvider>().get('/sales-report', {
    schema: { 
      tags: ['Dashboard'], 
      summary: 'Retorna dados do gráfico de faturamento',
      querystring: dashboardQuerySchema
    }
  }, dashboardController.salesReport);

  app.withTypeProvider<ZodTypeProvider>().get('/recent-orders', {
    schema: { 
      tags: ['Dashboard'], 
      summary: 'Lista histórico de pedidos com paginação',
      querystring: paginationQuerySchema
    }
  }, dashboardController.recentOrders);
}