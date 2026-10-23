import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapMercadoPagoStatus,
  mercadoPagoPaymentId,
  normalizeMercadoPagoWebhook,
} from '../src/modules/payments/payments.utils.js';

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
