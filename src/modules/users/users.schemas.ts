import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('ID inválido.'),
});

export const createUserBodySchema = z.object({
  name: z.string().min(3, 'O nome precisa ter pelo menos 3 caracteres.'),
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres.'),
  role: z.enum(['ADMIN', 'OPERADOR', 'VISUALIZADOR']).optional().default('OPERADOR'),
});

export const updateUserBodySchema = z.object({
  name: z.string().min(3, 'O nome precisa ter pelo menos 3 caracteres.').optional(),
  email: z.string().email('E-mail inválido.').optional(),
  password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres.').optional(),
  role: z.enum(['ADMIN', 'OPERADOR', 'VISUALIZADOR']).optional(),
  isActive: z.boolean().optional(),
});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type IdParam = z.infer<typeof idParamSchema>;