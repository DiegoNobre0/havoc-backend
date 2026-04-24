import { FastifyRequest, FastifyReply } from 'fastify';
import { DashboardService } from './dashboard.service.js';
import { DashboardQuery, PaginationQuery } from './dashboard.schema.js';


export class DashboardController {
  async summary(request: FastifyRequest, reply: FastifyReply) {
    const dashboardService = new DashboardService();
    const data = await dashboardService.getSummary();
    return reply.status(200).send(data);
  }

  async salesReport(request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) {
    const { startDate, endDate } = request.query;
    const dashboardService = new DashboardService();
    
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const data = await dashboardService.getSalesReport(start, end);
    return reply.status(200).send(data);
  }

  async recentOrders(request: FastifyRequest<{ Querystring: PaginationQuery }>, reply: FastifyReply) {
    const { page, limit, status } = request.query;
    const dashboardService = new DashboardService();
    
    const data = await dashboardService.getRecentOrders(page, limit, status);
    return reply.status(200).send(data);
  }
}