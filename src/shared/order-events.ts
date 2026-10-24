type OrderEventItem = {
  quantity: number;
  product: { name: string } | null;
  kit: { name: string } | null;
};

type OrderEventSource = {
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  total: unknown;
  items: OrderEventItem[];
};

export function newOrderEvent(order: OrderEventSource) {
  return {
    id: order.id,
    code: order.code,
    customer: order.customerName,
    total: Number(order.total),
    status: order.status,
  };
}

export function orderPrintEvent(
  order: OrderEventSource,
  payment: { paid: boolean; method: string },
) {
  return {
    codigo: order.code,
    cliente: order.customerName,
    telefone: order.customerPhone,
    endereco: order.deliveryAddress || '>>> RETIRADA BALCÃO <<<',
    itens: order.items.map((item) => `${item.quantity}x ${item.product?.name || item.kit?.name}`),
    total: Number(order.total),
    pago: payment.paid,
    pagamento: payment.method,
    data: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  };
}
