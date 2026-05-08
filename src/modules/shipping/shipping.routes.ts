import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { idParamSchema, createShippingRuleSchema, updateShippingRuleSchema } from './shipping.schemas.js';
import { ShippingController } from './shipping.controller.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';

export async function shippingRoutes(app: FastifyInstance) {
  const controller = new ShippingController();

  app.addHook('onRequest', verifyJwt);

  app.withTypeProvider<ZodTypeProvider>().get('/rules', {
    schema: { tags: ['Shipping'], summary: 'Lista regras de frete' }
  }, controller.listRules.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().post('/rules', {
    schema: { tags: ['Shipping'], summary: 'Cria regra de frete', body: createShippingRuleSchema }
  }, controller.createRule.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().put('/rules/:id', {
    schema: { tags: ['Shipping'], summary: 'Atualiza regra de frete', params: idParamSchema, body: updateShippingRuleSchema }
  }, controller.updateRule.bind(controller));

  app.withTypeProvider<ZodTypeProvider>().delete('/rules/:id', {
    schema: { tags: ['Shipping'], summary: 'Deleta regra de frete', params: idParamSchema }
  }, controller.deleteRule.bind(controller));
}