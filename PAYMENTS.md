# Payment setup

## Mercado Pago

Configure the production webhook as:

`https://api.havocsuplementos.shop/payments/webhook`

Subscribe to payment creation and payment update events. Set the generated webhook secret in `MERCADO_PAGO_WEBHOOK_SECRET`.

The application accepts both JSON-body notifications and query-only notifications. It always retrieves the payment from Mercado Pago before changing the local order.

## WhatsApp template

Create and approve these Utility templates in WhatsApp Manager. All templates use `pt_BR`; parameter `{{1}}` is the customer's first name and `{{2}}` is the order code.

- Name: `pagamento_confirmado`
- Body: `Pagamento confirmado, {{1}}! Recebemos o pagamento do pedido #{{2}}. Agora ele seguira para preparacao.`
- Name: `pedido_em_preparacao`
- Body: `Ola, {{1}}! O pedido #{{2}} esta em preparacao. Avisaremos na proxima atualizacao.`
- Name: `pedido_saiu_entrega`
- Body: `Ola, {{1}}! O pedido #{{2}} saiu para entrega.`
- Name: `pedido_pronto_retirada`
- Body: `Ola, {{1}}! O pedido #{{2}} esta pronto para retirada.`

Set the exact approved names in the corresponding environment variables.

## Required production variables

- `API_PUBLIC_URL`
- `STOREFRONT_URL`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `META_ACCESS_TOKEN`
- `META_PHONE_ID`
- `META_PAYMENT_CONFIRMED_TEMPLATE`
- `META_ORDER_PROCESSING_TEMPLATE`
- `META_ORDER_SHIPPED_TEMPLATE`
- `META_ORDER_READY_PICKUP_TEMPLATE`
