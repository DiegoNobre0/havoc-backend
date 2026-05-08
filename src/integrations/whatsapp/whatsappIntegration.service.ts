export class WhatsAppIntegrationService {
  private readonly token = process.env.META_ACCESS_TOKEN;
  private readonly phoneId = process.env.META_PHONE_ID;

  // Usa a versão mais recente da API da Meta
  private readonly apiUrl = `https://graph.facebook.com/v19.0/${this.phoneId}/messages`;

  // ─── HELPER: Ajuste do 9º Dígito Brasileiro ────────────────
  private formatPhoneNumber(phone: string): string {
    // Garante que só temos números
    let cleanPhone = phone.replace(/\D/g, '');

    // Verifica se é do Brasil (55) e se tem exatamente 12 dígitos (falta o 9)
    // Exemplo de entrada: 55 71 81482521 (12 dígitos)
    if (cleanPhone.startsWith('55') && cleanPhone.length === 12) {
      // Pega o "55" + "DDD" (4 primeiros dígitos) e concatena com o "9" e o resto do número
      cleanPhone = cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4);
      // Exemplo de saída: 55 71 9 81482521 (13 dígitos)
    }

    return cleanPhone;
  }
  // ──────────────────────────────────────────────────────────

  async sendTextMessage(to: string, text: string) {
    if (!this.token || !this.phoneId) {
      console.error('⚠️ Credenciais do WhatsApp (META_ACCESS_TOKEN ou META_PHONE_ID) não configuradas no .env');
      return;
    }

    // 1. Aplica a formatação do número antes de enviar
    const formattedTo = this.formatPhoneNumber(to);

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
          to: formattedTo, // Usando o número corrigido com o 9
          type: 'text',
          text: {
            preview_url: false,
            body: text,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`[WhatsApp Send Error - Number: ${formattedTo}]:`, JSON.stringify(errorData, null, 2));
      } else {
        // Um logzinho de sucesso ajuda muito a debugar!
        console.log(`[WhatsApp] ✅ Mensagem enviada com sucesso para ${formattedTo}`);
      }
    } catch (error) {
      console.error('[WhatsApp HTTP Error]:', error);
    }
  }

  // 👉 NOVA FUNÇÃO: Baixa áudios e imagens da Meta
  async downloadMedia(mediaId: string): Promise<Buffer | null> {
    if (!this.token) return null;

    try {
      // 1. Pega a URL do arquivo usando o ID
      const urlResponse = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!urlResponse.ok) throw new Error('Falha ao obter URL da mídia');
      const urlData = await urlResponse.json();

      // 2. Faz o download dos bytes (Buffer) do arquivo
      const mediaResponse = await fetch(urlData.url, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!mediaResponse.ok) throw new Error('Falha ao baixar arquivo');

      const arrayBuffer = await mediaResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);

    } catch (error) {
      console.error('[Meta Media Download Error]:', error);
      return null;
    }
  }

  // Envia Imagem Oficial do WhatsApp
  async sendImageMessage(to: string, imageUrl: string, caption?: string) {
    if (!this.token || !this.phoneId) return;

    const formattedTo = this.formatPhoneNumber(to);

    // Verifica se a URL é válida para a web
    if (!imageUrl || !imageUrl.startsWith('http')) {
      console.warn(`[WhatsApp] ⚠️ URL de imagem inválida ou local (${imageUrl}). Convertendo para mensagem de texto.`);
      
      // Se tinha alguma legenda junto com a foto quebrada, envia só a legenda para não perder a resposta
      if (caption) {
        await this.sendTextMessage(to, caption);
      }
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
          to: formattedTo,
          type: 'image',
          image: {
            link: imageUrl,
            caption: caption // Opcional: Texto junto com a foto
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`[WhatsApp Image Error]:`, JSON.stringify(errorData, null, 2));
      } else {
        console.log(`[WhatsApp] 📸 Imagem enviada para ${formattedTo}`);
      }
    } catch (error) {
      console.error('[WhatsApp HTTP Error]:', error);
    }
  }

async sendInteractiveImageMessage(
    to: string,
    bodyText: string,
    imageUrl: string,
    buttons: { id: string; title: string }[]
  ) {
    if (!this.token || !this.phoneId) return;

    const formattedTo = this.formatPhoneNumber(to);

    // Formata os botões para o padrão da Meta
    const safeButtons = buttons.map(btn => ({
      type: 'reply',
      reply: {
        id: btn.id.substring(0, 256),
        title: btn.title.substring(0, 20),
      }
    }));

    // Monta o payload interativo base
    const interactivePayload: any = {
      type: 'button',
      body: { text: bodyText.substring(0, 1024) },
      action: { buttons: safeButtons }
    };

    // Se a imagem existir, acopla ela no CABEÇALHO (header) da mensagem
    if (imageUrl) {
      interactivePayload.header = {
        type: 'image',
        image: {
          link: imageUrl
        }
      };
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
          to: formattedTo,
          type: 'interactive',
          interactive: interactivePayload
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        console.error('[WhatsApp Buttons Error]:', JSON.stringify(err, null, 2));
      } else {
        console.log(`[WhatsApp] 🔘 Imagem + Texto + Botões enviados unificados para ${formattedTo}`);
      }
    } catch (error) {
      console.error('[WhatsApp HTTP Error]:', error);
    }
  }

  // 👉 PLANO B: Envia apenas o texto e os botões se a imagem falhar
  async sendInteractiveTextMessage(to: string, bodyText: string, buttons: { id: string; title: string }[]) {
    const formattedTo = this.formatPhoneNumber(to);
    const safeButtons = buttons.map(btn => ({
      type: 'reply',
      reply: {
        id: btn.id.substring(0, 256),
        title: btn.title.substring(0, 20),
      }
    }));

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
          to: formattedTo,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: bodyText.substring(0, 1024) },
            action: { buttons: safeButtons }
          }
        }),
      });

      if (!response.ok) {
        console.error('[WhatsApp Fallback Error]:', await response.json());
      } else {
        console.log(`[WhatsApp] 🔘 Botões (sem imagem) enviados com sucesso para ${formattedTo}`);
      }
    } catch (err) {
      console.error(err);
    }
  }
}