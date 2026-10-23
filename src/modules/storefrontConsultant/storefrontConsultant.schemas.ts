import { z } from 'zod';

export const createConsultantSessionSchema = z.object({
  clientId: z.string().uuid(),
});

export const consultantSessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const consultantTokenHeadersSchema = z.object({
  'x-consultant-token': z.string().min(32).max(256),
});

export const consultantContextSchema = z.object({
  surface: z.enum(['catalog', 'product-detail', 'kit-detail']),
  item: z
    .object({
      type: z.enum(['product', 'kit']),
      id: z.string().uuid(),
      slug: z.string().trim().min(1).max(255),
    })
    .optional(),
});

export const createConsultantMessageSchema = z.object({
  content: z.string().trim().min(1).max(500),
  requestId: z.string().uuid(),
  context: consultantContextSchema,
});

export const consultantAudioQuerySchema = z
  .object({
    requestId: z.string().uuid(),
    surface: z.enum(['catalog', 'product-detail', 'kit-detail']),
    itemType: z.enum(['product', 'kit']).optional(),
    itemId: z.string().uuid().optional(),
    itemSlug: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((query, context) => {
    const itemValues = [query.itemType, query.itemId, query.itemSlug];
    if (itemValues.some(Boolean) && !itemValues.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message: 'itemType, itemId e itemSlug devem ser informados juntos.',
      });
    }
  });

export const modelConsultantResponseSchema = z.object({
  content: z.string().trim().min(1).max(600),
  recommendations: z
    .array(
      z.object({
        type: z.enum(['product', 'kit']),
        id: z.string().uuid(),
      }),
    )
    .max(3),
});

export type CreateConsultantSession = z.infer<typeof createConsultantSessionSchema>;
export type ConsultantSessionParams = z.infer<typeof consultantSessionParamsSchema>;
export type ConsultantTokenHeaders = z.infer<typeof consultantTokenHeadersSchema>;
export type CreateConsultantMessage = z.infer<typeof createConsultantMessageSchema>;
export type ConsultantContext = z.infer<typeof consultantContextSchema>;
export type ConsultantAudioQuery = z.infer<typeof consultantAudioQuerySchema>;
