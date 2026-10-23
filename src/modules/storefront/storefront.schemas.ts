import { z } from 'zod';
import { nutritionFactsSchema } from '../catalog/productFacts/product-facts.schemas.js';

export const storefrontTypeSchema = z.enum(['product', 'kit']);

export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  search: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().optional(),
  type: storefrontTypeSchema.optional(),
});

export const catalogItemParamsSchema = z.object({
  type: storefrontTypeSchema,
  slug: z.string().trim().min(1),
});

export const bestSellersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
  period: z.enum(['30d', '90d', 'all']).default('90d'),
});

const checkoutAddressSchema = z.object({
  street: z.string().trim().min(2),
  number: z.string().trim().min(1),
  complement: z.string().trim().optional(),
  neighborhood: z.string().trim().min(2),
  city: z.string().trim().min(2),
  state: z
    .string()
    .trim()
    .length(2)
    .transform((state) => state.toUpperCase()),
  reference: z.string().trim().optional(),
});

export const checkoutBodySchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(3),
      phone: z.string().trim().min(10),
      cpf: z.string().trim().min(11),
      email: z
        .union([z.string().trim().email(), z.literal('')])
        .optional()
        .transform((email) => email || undefined),
      notes: z.string().trim().optional(),
    }),
    items: z
      .array(
        z.object({
          type: storefrontTypeSchema,
          id: z.string().uuid(),
          quantity: z.number().int().min(1).max(20),
        }),
      )
      .min(1)
      .max(30),
    delivery: z.discriminatedUnion('method', [
      z.object({ method: z.literal('PICKUP') }),
      z.object({
        method: z.literal('DELIVERY'),
        shippingRuleId: z.string().uuid().optional(),
        customNeighborhood: z.string().trim().min(2).optional(),
        address: checkoutAddressSchema,
      }),
    ]),
    paymentMethod: z.enum(['PIX', 'CREDIT_CARD', 'CASH']),
  })
  .superRefine((checkout, context) => {
    if (checkout.paymentMethod === 'CASH' && checkout.delivery.method !== 'PICKUP') {
      context.addIssue({
        code: 'custom',
        path: ['paymentMethod'],
        message: 'Pagamento em dinheiro só é permitido para retirada.',
      });
    }

    if (
      checkout.delivery.method === 'DELIVERY' &&
      !checkout.delivery.shippingRuleId &&
      !checkout.delivery.customNeighborhood
    ) {
      context.addIssue({
        code: 'custom',
        path: ['delivery', 'customNeighborhood'],
        message: 'Informe o bairro para entrega fora das regiões cadastradas.',
      });
    }
  });

export const checkoutHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8).max(128),
});

export const checkoutStatusParamsSchema = z.object({ orderId: z.string().uuid() });
export const checkoutStatusQuerySchema = z.object({
  token: z.string().min(32),
  paymentId: z.string().regex(/^\d+$/).optional(),
});

export const publicCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

const publicCatalogItemFields = {
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: z.number(),
  available: z.boolean(),
  categories: z.array(publicCategorySchema),
  createdAt: z.string().datetime(),
};

export const publicCatalogItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('product'), ...publicCatalogItemFields }),
  z.object({ type: z.literal('kit'), ...publicCatalogItemFields }),
]);

export const publicProductLabelSchema = z.object({
  manufacturer: z.string().nullable(),
  manufacturerDomain: z.string(),
  servingSize: z.string().nullable(),
  servingsPerContainer: z.string().nullable(),
  usageInstructions: z.string().nullable(),
  ingredients: z.string().nullable(),
  allergenStatement: z.string().nullable(),
  warnings: z.array(z.string()).nullable(),
  nutritionFacts: nutritionFactsSchema.nullable(),
  source: z.object({
    url: z.string().url(),
    title: z.string().nullable(),
    retrievedAt: z.string().datetime(),
  }),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CatalogItemParams = z.infer<typeof catalogItemParamsSchema>;
export type BestSellersQuery = z.infer<typeof bestSellersQuerySchema>;
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
export type CheckoutHeaders = z.infer<typeof checkoutHeadersSchema>;
export type CheckoutStatusParams = z.infer<typeof checkoutStatusParamsSchema>;
export type CheckoutStatusQuery = z.infer<typeof checkoutStatusQuerySchema>;
