import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapMercadoPagoStatus,
  mercadoPagoPaymentId,
  normalizeMercadoPagoWebhook,
} from '../src/modules/payments/payments.utils.js';
import { newOrderEvent, orderPrintEvent } from '../src/shared/order-events.js';
import { WHATSAPP_TEMPLATES } from '../src/integrations/whatsapp/whatsapp.templates.js';

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
