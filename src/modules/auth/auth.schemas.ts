import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(1, 'A senha é obrigatória.'),
});

export const refreshTokenBodySchema = z.object({
  refreshToken: z.string().uuid('Refresh token inválido.'),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;