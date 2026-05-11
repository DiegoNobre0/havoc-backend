import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid()
});

export const createPixSchema = z.object({
  orderId: z.string().uuid('ID do pedido inválido.'),
  email: z.string().email('E-mail obrigatório para o Pix').default('cliente@havoc.com.br'),
  name: z.string().default('Cliente Havoc'),
  cpf: z.string().optional(), // MP exige CPF para PIX em algumas contas, mas podemos tentar sem ou com um genérico
});

export const createLinkSchema = z.object({
  orderId: z.string().uuid('ID do pedido inválido.'),
});

export type CreatePixBody = z.infer<typeof createPixSchema>;
export type CreateLinkBody = z.infer<typeof createLinkSchema>;