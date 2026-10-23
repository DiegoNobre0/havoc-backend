import { FastifyReply, FastifyRequest } from 'fastify';
import { StorefrontService } from './storefront.service.js';
import type {
  BestSellersQuery,
  CatalogItemParams,
  CatalogQuery,
  CheckoutBody,
  CheckoutHeaders,
  CheckoutStatusParams,
  CheckoutStatusQuery,
} from './storefront.schemas.js';
import { StorefrontCheckoutService } from './storefront-checkout.service.js';

export class StorefrontController {
  private readonly service = new StorefrontService();
  private readonly checkoutService = new StorefrontCheckoutService();

  async checkout(
    request: FastifyRequest<{ Body: CheckoutBody; Headers: CheckoutHeaders }>,
    reply: FastifyReply,
  ) {
    return reply
      .status(201)
      .send(await this.checkoutService.checkout(request.body, request.headers['idempotency-key']));
  }

  async checkoutStatus(
    request: FastifyRequest<{ Params: CheckoutStatusParams; Querystring: CheckoutStatusQuery }>,
    reply: FastifyReply,
  ) {
    return reply.send(
      await this.checkoutService.getStatus(
        request.params.orderId,
        request.query.token,
        request.query.paymentId,
      ),
    );
  }

  async catalog(request: FastifyRequest<{ Querystring: CatalogQuery }>, reply: FastifyReply) {
    return reply.send(await this.service.getCatalog(request.query));
  }

  async details(request: FastifyRequest<{ Params: CatalogItemParams }>, reply: FastifyReply) {
    const { type, slug } = request.params;
    return reply.send(await this.service.getDetails(type, slug));
  }

  async categories(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ data: await this.service.getCategories() });
  }

  async shippingRegions(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ data: await this.service.getShippingRegions() });
  }

  async bestSellers(
    request: FastifyRequest<{ Querystring: BestSellersQuery }>,
    reply: FastifyReply,
  ) {
    return reply.send(await this.service.getBestSellers(request.query.limit, request.query.period));
  }
}
