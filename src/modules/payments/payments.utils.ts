import type { PaymentStatus } from '@prisma/client';

export function mapMercadoPagoStatus(status?: string, detail?: string): PaymentStatus | null {
  if (status === 'approved') return 'PAID';
  if (status === 'refunded' || status === 'charged_back') return 'REFUNDED';
  if (status === 'cancelled' && detail?.includes('expired')) return 'EXPIRED';
  if (status === 'rejected' || status === 'cancelled') return 'FAILED';
  if (['pending', 'in_process', 'in_mediation', 'authorized'].includes(status ?? '')) {
    return 'PENDING';
  }
  return null;
}

export function mercadoPagoPaymentId(value: unknown) {
  const match = String(value ?? '').match(/(\d+)(?:\D*)$/);
  return match?.[1] ?? null;
}

export function normalizeMercadoPagoWebhook(
  body: Record<string, any> | null | undefined,
  query: Record<string, unknown>,
) {
  const payload = body && typeof body === 'object' ? body : {};
  const type = String(
    payload.action || payload.type || payload.topic || query.type || query.topic || '',
  );
  const paymentId = mercadoPagoPaymentId(
    payload.data?.id || payload.resource || query['data.id'] || query.id,
  );
  if (!['payment', 'payment.created', 'payment.updated'].includes(type) || !paymentId) return null;
  return {
    ...payload,
    type,
    data: { ...(payload.data ?? {}), id: String(paymentId) },
  };
}
