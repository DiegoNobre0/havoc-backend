import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid()
});

export const sessionQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional()
});

export const sendMessageSchema = z.object({
  content: z.string().min(1, 'A mensagem não pode estar vazia')
});

export const toggleStatusSchema = z.object({
  isActive: z.boolean()
});

export const updateConfigBodySchema = z.object({
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  fallbackMessage: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateConfigBody = z.infer<typeof updateConfigBodySchema>;