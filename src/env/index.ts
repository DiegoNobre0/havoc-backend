import { z } from 'zod';
import 'dotenv/config';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['dev', 'test', 'production']).default('dev'),
    PORT: z.coerce.number().default(3333),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(16),
    API_PUBLIC_URL: z.string().url().optional(),
    STOREFRONT_URL: z.string().url().optional(),
    MERCADO_PAGO_ACCESS_TOKEN: z.string().min(20).optional(),
    MERCADO_PAGO_WEBHOOK_SECRET: z.string().min(16).optional(),
    META_ACCESS_TOKEN: z.string().min(20).optional(),
    META_PHONE_ID: z.string().trim().min(1).optional(),
    SERPER_API_KEY: z.string().trim().min(1).optional(),
    OPENAI_API_KEY: z.string().trim().min(1).optional(),
    OPENAI_PRODUCT_FACTS_MODEL: z.string().trim().min(1).optional(),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV !== 'production') return;
    for (const key of [
      'API_PUBLIC_URL',
      'STOREFRONT_URL',
      'MERCADO_PAGO_ACCESS_TOKEN',
      'MERCADO_PAGO_WEBHOOK_SECRET',
      'META_ACCESS_TOKEN',
      'META_PHONE_ID',
      'SERPER_API_KEY',
      'OPENAI_API_KEY',
    ] as const) {
      if (!values[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} é obrigatório em produção.`,
        });
      }
    }
  });

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Configuração de ambiente inválida:', _env.error.format());
  throw new Error('Configuração de ambiente inválida.');
}

export const env = _env.data;
