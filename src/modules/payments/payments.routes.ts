import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PaymentsController } from './payments.controller.js';
import { createPixSchema, createLinkSchema, idParamSchema } from './payments.schemas.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';

export async function paymentsRoutes(app: FastifyInstance) {
  const controller = new PaymentsController();

  // ==========================================
  // 🔓 ROTA PÚBLICA (WEBHOOK DO MERCADO PAGO)
  // ==========================================
  app.post(
    '/webhook',
    {
      schema: { tags: ['Pagamentos'], summary: 'Recebe notificações do Mercado Pago' },
    },
    controller.webhook.bind(controller),
  );

  app.post(
    '/print-test',
    {
      schema: { tags: ['Teste'], summary: 'Dispara uma impressão de teste na loja física' },
    },
    controller.testPrint.bind(controller),
  );

  // ==========================================
  // 🔒 ROTAS PROTEGIDAS (GERAÇÃO E STATUS)
  // ==========================================
  app.register(async (protectedApp) => {
    protectedApp.addHook('onRequest', verifyJwt);

    protectedApp.withTypeProvider<ZodTypeProvider>().post(
      '/pix',
      {
        schema: { tags: ['Pagamentos'], summary: 'Gera QR Code Pix', body: createPixSchema },
      },
      controller.generatePix.bind(controller),
    );

    protectedApp.withTypeProvider<ZodTypeProvider>().post(
      '/link',
      {
        schema: {
          tags: ['Pagamentos'],
          summary: 'Gera link de checkout (Cartão/Boleto)',
          body: createLinkSchema,
        },
      },
      controller.generateLink.bind(controller),
    );

    protectedApp.withTypeProvider<ZodTypeProvider>().get(
      '/:id/status',
      {
        schema: {
          tags: ['Pagamentos'],
          summary: 'Verifica o status atual do pagamento',
          params: idParamSchema,
        },
      },
      controller.checkStatus.bind(controller),
    );
  });
}
