import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError.js';

type StockOrderItem = {
  quantity: number;
  product: { id: string; name: string } | null;
  kit: {
    items: Array<{
      quantity: number;
      product: { id: string; name: string };
    }>;
  } | null;
};

export function orderStockRequirements(items: StockOrderItem[]) {
  const required = new Map<string, { productId: string; name: string; quantity: number }>();

  const add = (productId: string, name: string, quantity: number) => {
    const current = required.get(productId);
    required.set(productId, {
      productId,
      name,
      quantity: (current?.quantity ?? 0) + quantity,
    });
  };

  for (const item of items) {
    if (item.product) add(item.product.id, item.product.name, item.quantity);
    for (const component of item.kit?.items ?? []) {
      add(component.product.id, component.product.name, component.quantity * item.quantity);
    }
  }

  return [...required.values()];
}

export async function decrementOrderStock(
  transaction: Prisma.TransactionClient,
  orderId: string,
  options: { allowNegative?: boolean } = {},
) {
  const items = await transaction.orderItem.findMany({
    where: { orderId },
    select: {
      quantity: true,
      product: { select: { id: true, name: true } },
      kit: {
        select: {
          items: {
            select: {
              quantity: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  for (const requirement of orderStockRequirements(items)) {
    if (options.allowNegative) {
      await transaction.product.update({
        where: { id: requirement.productId },
        data: { stock: { decrement: requirement.quantity } },
      });
      continue;
    }
    const updated = await transaction.product.updateMany({
      where: { id: requirement.productId, stock: { gte: requirement.quantity } },
      data: { stock: { decrement: requirement.quantity } },
    });
    if (updated.count !== 1) {
      throw new AppError(`Estoque insuficiente para ${requirement.name}.`, 409);
    }
  }
}

export async function applyPaidPaymentStock(
  transaction: Prisma.TransactionClient,
  paymentId: string,
  orderId: string,
  paymentUpdate: Prisma.PaymentUpdateManyMutationInput,
) {
  const claimed = await transaction.payment.updateMany({
    where: { id: paymentId, status: { not: 'PAID' } },
    data: paymentUpdate,
  });
  if (claimed.count !== 1) return false;

  await decrementOrderStock(transaction, orderId, { allowNegative: true });
  return true;
}
