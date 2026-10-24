import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { env } from '../../env/index.js';
import { AppError } from '../../shared/errors/AppError.js';
import { redis } from '../../shared/redis/redis.js';
import { newOrderEvent, orderPrintEvent } from '../../shared/order-events.js';
import { io } from '../../shared/socket/socket.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { CheckoutBody } from './storefront.schemas.js';

const FALLBACK_SHIPPING_COST = new Prisma.Decimal(15);
const checkoutOrderInclude = Prisma.validator<Prisma.OrderInclude>()({
  items: {
    include: { product: { select: { name: true } }, kit: { select: { name: true } } },
  },
});
type CheckoutOrder = Prisma.OrderGetPayload<{ include: typeof checkoutOrderInclude }>;

export class StorefrontCheckoutService {
  private readonly paymentsService = new PaymentsService();

  async checkout(input: CheckoutBody, idempotencyKey?: string) {
    if (!idempotencyKey) return this.createCheckout(input);

    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const sessionKey = `storefront:checkout:${keyHash}`;
    const lockKey = `${sessionKey}:lock`;
    const existing = await this.getIdempotentOrder(sessionKey, requestHash);
    if (existing) return this.finishCheckout(existing, input);

    const lockToken = crypto.randomUUID();
    const acquired = await redis.set(lockKey, lockToken, 'EX', 30, 'NX');
    if (!acquired) throw new AppError('Este checkout já está sendo processado.', 409);

    try {
      const rechecked = await this.getIdempotentOrder(sessionKey, requestHash);
      if (rechecked) return this.finishCheckout(rechecked, input);

      return await this.createCheckout(input, async (orderId) => {
        await redis.set(sessionKey, JSON.stringify({ requestHash, orderId }), 'EX', 24 * 60 * 60);
      });
    } finally {
      await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        lockKey,
        lockToken,
      );
    }
  }

  private async createCheckout(
    input: CheckoutBody,
    onOrderCreated?: (orderId: string) => Promise<void>,
  ) {
    const productIds = input.items.filter((item) => item.type === 'product').map((item) => item.id);
    const kitIds = input.items.filter((item) => item.type === 'kit').map((item) => item.id);
    const [products, kits] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds }, isActive: true, deletedAt: null },
        select: { id: true, name: true, price: true, stock: true },
      }),
      prisma.kit.findMany({
        where: { id: { in: kitIds }, isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          finalPrice: true,
          items: {
            select: {
              quantity: true,
              product: {
                select: { id: true, name: true, stock: true, isActive: true, deletedAt: true },
              },
            },
          },
        },
      }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const kitById = new Map(kits.map((kit) => [kit.id, kit]));
    const requiredStock = new Map<string, { name: string; quantity: number; stock: number }>();
    const addRequiredStock = (id: string, name: string, quantity: number, stock: number) => {
      const current = requiredStock.get(id);
      requiredStock.set(id, { name, stock, quantity: (current?.quantity ?? 0) + quantity });
    };

    const orderItems = input.items.map((item) => {
      if (item.type === 'product') {
        const product = productById.get(item.id);
        if (!product) throw new AppError('Produto indisponível.', 400);
        addRequiredStock(product.id, product.name, item.quantity, product.stock);
        return {
          type: item.type,
          name: product.name,
          quantity: item.quantity,
          unitPrice: product.price,
          totalPrice: product.price.mul(item.quantity),
          productId: product.id,
          kitId: null,
        };
      }

      const kit = kitById.get(item.id);
      if (!kit || kit.items.length === 0) throw new AppError('Kit indisponível.', 400);
      for (const component of kit.items) {
        if (!component.product.isActive || component.product.deletedAt !== null) {
          throw new AppError(`O kit ${kit.name} possui item indisponível.`, 400);
        }
        addRequiredStock(
          component.product.id,
          component.product.name,
          component.quantity * item.quantity,
          component.product.stock,
        );
      }
      return {
        type: item.type,
        name: kit.name,
        quantity: item.quantity,
        unitPrice: kit.finalPrice,
        totalPrice: kit.finalPrice.mul(item.quantity),
        productId: null,
        kitId: kit.id,
      };
    });

    for (const requirement of requiredStock.values()) {
      if (requirement.stock < requirement.quantity) {
        throw new AppError(`Estoque insuficiente para ${requirement.name}.`, 400);
      }
    }

    let shippingCost = new Prisma.Decimal(0);
    let shippingRuleId: string | null = null;
    let deliveryAddress: string | null = null;
    if (input.delivery.method === 'DELIVERY') {
      const { address } = input.delivery;
      if (input.delivery.shippingRuleId) {
        const rule = await prisma.shippingRule.findFirst({
          where: {
            id: input.delivery.shippingRuleId,
            isActive: true,
            type: 'BY_REGION',
            region: { not: null },
          },
          select: { id: true, region: true, price: true },
        });
        if (!rule) throw new AppError('Regra de frete inválida ou inativa.', 400);
        if (
          rule.region!.trim().toLocaleLowerCase('pt-BR') !==
          address.neighborhood.toLocaleLowerCase('pt-BR')
        ) {
          throw new AppError('O bairro do endereço não corresponde à região de entrega.', 400);
        }
        shippingCost = rule.price;
        shippingRuleId = rule.id;
      } else {
        shippingCost = FALLBACK_SHIPPING_COST;
      }
      deliveryAddress = this.formatAddress(address);
    }

    const subtotal = orderItems.reduce(
      (total, item) => total.add(item.totalPrice),
      new Prisma.Decimal(0),
    );
    const discount = new Prisma.Decimal(0);
    const total = subtotal.add(shippingCost).sub(discount);
    const code = `HAV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const initialStatus =
      input.paymentMethod === 'CASH' ? ('CONFIRMED' as const) : ('PENDING' as const);
    const order = await prisma.$transaction((transaction) =>
      transaction.order.create({
        data: {
          code,
          status: initialStatus,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          customerCpf: input.customer.cpf,
          deliveryAddress,
          deliveryMethod: input.delivery.method,
          paymentMethod: input.paymentMethod,
          shippingRuleId,
          subtotal,
          shippingCost,
          discount,
          total,
          notes: input.customer.notes ?? null,
          items: {
            create: orderItems.map((item) => ({
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              productId: item.productId,
              kitId: item.kitId,
            })),
          },
          statusHistory: {
            create: {
              status: initialStatus,
              note:
                input.paymentMethod === 'CASH'
                  ? 'Pedido confirmado para pagamento em dinheiro na retirada.'
                  : 'Pedido criado pelo checkout web e aguardando pagamento.',
            },
          },
        },
        include: checkoutOrderInclude,
      }),
    );

    await onOrderCreated?.(order.id);
    this.publishOrderCreated(order, input.paymentMethod === 'CASH');

    return this.finishCheckout(order, input);
  }

  private publishOrderCreated(order: CheckoutOrder, printCashOrder: boolean) {
    if (!io) return;

    io.to('all_chats').emit('new_order', newOrderEvent(order));

    if (!printCashOrder) return;
    io.to('loja_fisica').emit(
      'imprimir_cupom',
      orderPrintEvent(order, { paid: false, method: 'DINHEIRO' }),
    );
  }

  private async finishCheckout(order: CheckoutOrder, input: CheckoutBody) {
    const checkoutToken = this.createToken(order.id);
    let payment = null;
    if (input.paymentMethod === 'PIX') {
      payment = await this.paymentsService.generatePix(
        order.id,
        input.customer.email ?? '',
        input.customer.name,
        input.customer.cpf,
      );
    } else if (input.paymentMethod === 'CREDIT_CARD') {
      payment = await this.paymentsService.generateLink(order.id, checkoutToken);
    }

    return {
      order: {
        id: order.id,
        code: order.code,
        status: order.status,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        deliveryMethod: input.delivery.method,
        deliveryAddress: order.deliveryAddress,
        paymentMethod: input.paymentMethod,
        subtotal: Number(order.subtotal),
        shippingCost: Number(order.shippingCost),
        discount: Number(order.discount),
        total: Number(order.total),
        notes: order.notes,
        items: order.items.map((item) => ({
          id: item.id,
          type: item.productId ? ('product' as const) : ('kit' as const),
          name: item.product?.name ?? item.kit!.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })),
      },
      payment: payment
        ? {
            id: payment.id,
            method: input.paymentMethod,
            status: payment.status,
            pixCode: payment.pixCode,
            qrCodeImage: payment.pixQrCodeUrl,
            expiresAt: payment.expiresAt,
            redirectUrl: payment.paymentLink,
          }
        : null,
      checkoutToken,
    };
  }

  private async getIdempotentOrder(sessionKey: string, requestHash: string) {
    const stored = await redis.get(sessionKey);
    if (!stored) return null;

    let session: { requestHash?: string; orderId?: string };
    try {
      session = JSON.parse(stored) as { requestHash?: string; orderId?: string };
    } catch {
      await redis.del(sessionKey);
      return null;
    }
    if (session.requestHash !== requestHash) {
      throw new AppError('A chave de idempotência já foi usada com outro checkout.', 409);
    }
    if (!session.orderId) return null;

    const order = await prisma.order.findUnique({
      where: { id: session.orderId },
      include: checkoutOrderInclude,
    });
    if (!order) {
      await redis.del(sessionKey);
      return null;
    }
    return order;
  }

  async getStatus(orderId: string, token: string, providerPaymentId?: string) {
    if (!this.isValidToken(orderId, token)) throw new AppError('Token de checkout inválido.', 401);
    try {
      await this.paymentsService.reconcileOrderPayment(orderId, providerPaymentId);
    } catch (error) {
      if (error instanceof AppError && [400, 404, 409].includes(error.statusCode)) throw error;
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        code: true,
        status: true,
        payment: {
          select: {
            status: true,
            providerStatus: true,
            statusDetail: true,
            paidAt: true,
            expiresAt: true,
          },
        },
      },
    });
    if (!order) throw new AppError('Pedido não encontrado.', 404);
    return {
      orderCode: order.code,
      orderStatus: order.status,
      paymentStatus: order.payment?.status ?? null,
      providerStatus: order.payment?.providerStatus ?? null,
      statusDetail: order.payment?.statusDetail ?? null,
      paidAt: order.payment?.paidAt ?? null,
      expiresAt: order.payment?.expiresAt ?? null,
    };
  }

  private createToken(orderId: string) {
    const payload = Buffer.from(
      JSON.stringify({ orderId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }),
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', env.JWT_SECRET)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private isValidToken(orderId: string, token: string) {
    const [payload, providedSignature, extra] = token.split('.');
    if (!payload || !providedSignature || extra) return false;
    let tokenPayload: { orderId?: string; expiresAt?: number };
    try {
      tokenPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        orderId?: string;
        expiresAt?: number;
      };
    } catch {
      return false;
    }
    if (
      tokenPayload.orderId !== orderId ||
      typeof tokenPayload.expiresAt !== 'number' ||
      tokenPayload.expiresAt < Date.now()
    ) {
      return false;
    }
    const expectedSignature = crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest();
    const providedBuffer = Buffer.from(providedSignature, 'base64url');
    return (
      providedBuffer.length === expectedSignature.length &&
      crypto.timingSafeEqual(providedBuffer, expectedSignature)
    );
  }

  private formatAddress(
    address: Extract<CheckoutBody['delivery'], { method: 'DELIVERY' }>['address'],
  ) {
    return [
      `${address.street}, ${address.number}`,
      address.complement,
      address.neighborhood,
      `${address.city}/${address.state}`,
      address.reference ? `Referência: ${address.reference}` : undefined,
    ]
      .filter(Boolean)
      .join(' - ');
  }
}
