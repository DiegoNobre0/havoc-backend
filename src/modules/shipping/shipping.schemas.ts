import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid()
});

export const createShippingRuleSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['BY_CEP', 'BY_REGION', 'BY_WEIGHT']),
  cep: z.string().optional(),
  region: z.string().optional(),
  minWeight: z.number().optional(),
  maxWeight: z.number().optional(),
  price: z.number().min(0),
  estimatedDays: z.number().int().min(1).default(7),
  isActive: z.boolean().default(true),
});

export const updateShippingRuleSchema = createShippingRuleSchema.partial();