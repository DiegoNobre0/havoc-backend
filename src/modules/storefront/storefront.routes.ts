import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { StorefrontController } from './storefront.controller.js';
import {
  bestSellersQuerySchema,
  catalogItemParamsSchema,
  catalogQuerySchema,
  checkoutBodySchema,
  checkoutHeadersSchema,
  checkoutStatusParamsSchema,
  checkoutStatusQuerySchema,
} from './storefront.schemas.js';

export async function storefrontRoutes(app: FastifyInstance) {
  const controller = new StorefrontController();
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/checkout',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Cria um pedido no checkout público',
        headers: checkoutHeadersSchema,
        body: checkoutBodySchema,
      },
    },
    controller.checkout.bind(controller),
  );

  routes.get(
    '/checkout/:orderId/status',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Consulta o status de um checkout público',
        params: checkoutStatusParamsSchema,
        querystring: checkoutStatusQuerySchema,
      },
    },
    controller.checkoutStatus.bind(controller),
  );

  routes.get(
    '/catalog',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Lista o catálogo público unificado de produtos e kits',
        querystring: catalogQuerySchema,
      },
    },
    controller.catalog.bind(controller),
  );

  routes.get(
    '/catalog/:type/:slug',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Retorna os detalhes de um item público pelo slug',
        params: catalogItemParamsSchema,
      },
    },
    controller.details.bind(controller),
  );

  routes.get(
    '/categories',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Lista as categorias públicas ativas',
      },
    },
    controller.categories.bind(controller),
  );

  routes.get(
    '/shipping/regions',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Lista os bairros com entrega ativa',
      },
    },
    controller.shippingRegions.bind(controller),
  );

  routes.get(
    '/best-sellers',
    {
      schema: {
        tags: ['Storefront'],
        summary: 'Lista os produtos e kits mais vendidos',
        querystring: bestSellersQuerySchema,
      },
    },
    controller.bestSellers.bind(controller),
  );
}
