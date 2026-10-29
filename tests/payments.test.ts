import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapMercadoPagoStatus,
  mercadoPagoPaymentId,
  normalizeMercadoPagoWebhook,
} from '../src/modules/payments/payments.utils.js';
import { newOrderEvent, orderPrintEvent } from '../src/shared/order-events.js';
import { WHATSAPP_TEMPLATES } from '../src/integrations/whatsapp/whatsapp.templates.js';
import {
  applyPaidPaymentStock,
  decrementOrderStock,
  orderStockRequirements,
} from '../src/modules/payments/payments.inventory.js';

test('maps every relevant Mercado Pago state to the local payment state', () => {
  assert.equal(mapMercadoPagoStatus('approved'), 'PAID');
  assert.equal(mapMercadoPagoStatus('pending'), 'PENDING');
  assert.equal(mapMercadoPagoStatus('in_process'), 'PENDING');
  assert.equal(mapMercadoPagoStatus('rejected'), 'FAILED');
  assert.equal(mapMercadoPagoStatus('cancelled', 'expired'), 'EXPIRED');
  assert.equal(mapMercadoPagoStatus('refunded'), 'REFUNDED');
  assert.equal(mapMercadoPagoStatus('charged_back'), 'REFUNDED');
  assert.equal(mapMercadoPagoStatus('unknown'), null);
});

test('normalizes body and query-only Mercado Pago notifications', () => {
  assert.deepEqual(
    normalizeMercadoPagoWebhook({ action: 'payment.updated', data: { id: 123 } }, {}),
    { action: 'payment.updated', type: 'payment.updated', data: { id: '123' } },
  );
  assert.deepEqual(
    normalizeMercadoPagoWebhook(null, { type: 'payment', 'data.id': '456' }),
    { type: 'payment', data: { id: '456' } },
  );
  assert.deepEqual(
    normalizeMercadoPagoWebhook(
      { topic: 'payment', resource: 'https://api.mercadopago.com/v1/payments/789' },
      {},
    ),
    {
      topic: 'payment',
      resource: 'https://api.mercadopago.com/v1/payments/789',
      type: 'payment',
      data: { id: '789' },
    },
  );
  assert.equal(normalizeMercadoPagoWebhook({}, { type: 'merchant_order', id: '1' }), null);
  assert.equal(mercadoPagoPaymentId('https://api.mercadopago.com/v1/payments/789'), '789');
});

test('builds real-time order and print payloads with the correct payment state', () => {
  const order = {
    id: 'order-1',
    code: 'HAV-123',
    status: 'CONFIRMED',
    customerName: 'Cliente Teste',
    customerPhone: '5571999999999',
    deliveryAddress: null,
    total: '149.90',
    items: [
      { quantity: 2, product: { name: 'Creatina 300g' }, kit: null },
      { quantity: 1, product: null, kit: { name: 'Kit Massa' } },
    ],
  };

  assert.deepEqual(newOrderEvent(order), {
    id: 'order-1',
    code: 'HAV-123',
    customer: 'Cliente Teste',
    total: 149.9,
    status: 'CONFIRMED',
  });
  const print = orderPrintEvent(order, { paid: false, method: 'DINHEIRO' });
  assert.equal(print.pago, false);
  assert.equal(print.pagamento, 'DINHEIRO');
  assert.equal(print.endereco, '>>> RETIRADA BALCÃO <<<');
  assert.deepEqual(print.itens, ['2x Creatina 300g', '1x Kit Massa']);
});

test('keeps approved WhatsApp template names in code', () => {
  assert.deepEqual(WHATSAPP_TEMPLATES, {
    paymentConfirmed: 'pagamento_confirmado',
    orderProcessing: 'pedido_em_preparacao',
    orderShipped: 'pedido_saiu_entrega',
    orderReadyForPickup: 'pedido_pronto_retirada',
  });
});

test('calculates stock for products and expands repeated kit components', () => {
  const requirements = orderStockRequirements([
    {
      quantity: 2,
      product: { id: 'creatine', name: 'Creatina' },
      kit: null,
    },
    {
      quantity: 3,
      product: null,
      kit: {
        items: [
          { quantity: 1, product: { id: 'creatine', name: 'Creatina' } },
          { quantity: 2, product: { id: 'whey', name: 'Whey' } },
        ],
      },
    },
  ]);

  assert.deepEqual(requirements, [
    { productId: 'creatine', name: 'Creatina', quantity: 5 },
    { productId: 'whey', name: 'Whey', quantity: 6 },
  ]);
});

test('decrements stock only for the first paid confirmation', async () => {
  let paid = false;
  const decrements: number[] = [];
  const transaction = {
    payment: {
      updateMany: async () => {
        if (paid) return { count: 0 };
        paid = true;
        return { count: 1 };
      },
    },
    orderItem: {
      findMany: async () => [
        { quantity: 2, product: { id: 'product-1', name: 'Creatina' }, kit: null },
      ],
    },
    product: {
      update: async ({ data }: { data: { stock: { decrement: number } } }) => {
        decrements.push(data.stock.decrement);
        return {};
      },
    },
  };

  assert.equal(
    await applyPaidPaymentStock(transaction as never, 'payment-1', 'order-1', { status: 'PAID' }),
    true,
  );
  assert.equal(
    await applyPaidPaymentStock(transaction as never, 'payment-1', 'order-1', { status: 'PAID' }),
    false,
  );
  assert.deepEqual(decrements, [2]);
});

test('records the sale atomically even when concurrent orders consumed the remaining stock', async () => {
  const decrements: number[] = [];
  const transaction = {
    orderItem: {
      findMany: async () => [
        { quantity: 2, product: { id: 'product-1', name: 'Creatina' }, kit: null },
      ],
    },
    product: {
      update: async ({ data }: { data: { stock: { decrement: number } } }) => {
        decrements.push(data.stock.decrement);
        return {};
      },
    },
  };

  await decrementOrderStock(transaction as never, 'order-1', { allowNegative: true });
  assert.deepEqual(decrements, [2]);
});

test('keeps unpaid cash checkout from creating negative inventory', async () => {
  const transaction = {
    orderItem: {
      findMany: async () => [
        { quantity: 2, product: { id: 'product-1', name: 'Creatina' }, kit: null },
      ],
    },
    product: { updateMany: async () => ({ count: 0 }) },
  };

  await assert.rejects(
    decrementOrderStock(transaction as never, 'order-1'),
    /Estoque insuficiente para Creatina/,
  );
});
