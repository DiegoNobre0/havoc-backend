    import z from 'zod';

// Enum do Prisma espelhado no Zod para validação
const OrderStatusEnum = z.enum([
  'PENDING', 'CONFIRMED', 'PROCESSING', 
  'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'
]);

export const orderIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const orderQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  deliveryAddress: z.string().optional(), // Para buscar por endereço de entrega
  search: z.string().optional(), // Para buscar por código (HAV-1234) ou telefone
  status: OrderStatusEnum.optional(),
});

export const updateOrderStatusSchema = z.object({
  status: OrderStatusEnum,
  note: z.string().optional(), // Nota opcional para ficar no histórico (ex: "Entregue ao porteiro")
});