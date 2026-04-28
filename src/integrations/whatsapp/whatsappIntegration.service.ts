export class WhatsAppIntegrationService {
  private readonly token = process.env.META_ACCESS_TOKEN;
  private readonly phoneId = process.env.META_PHONE_ID;

  // Usa a versão mais recente da API da Meta (ajuste a versão se necessário)
  private readonly apiUrl = `https://graph.facebook.com/v19.0/${this.phoneId}/messages`;

  async sendTextMessage(to: string, text: string) {
    if (!this.token || !this.phoneId) {
      console.error('⚠️ Credenciais do WhatsApp (META_ACCESS_TOKEN ou META_PHONE_ID) não configuradas no .env');
      return;
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to, // O número do cliente
          type: 'text',
          text: {
            preview_url: false,
            body: text,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[WhatsApp Send Error]:', JSON.stringify(errorData, null, 2));
      }
    } catch (error) {
      console.error('[WhatsApp HTTP Error]:', error);
    }
  }
}