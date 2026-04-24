import { z } from 'zod';

// Validação para os filtros de data (padrão: últimos 30 dias se não enviar nada)
export const dashboardQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(10000).default(10),
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']).optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;