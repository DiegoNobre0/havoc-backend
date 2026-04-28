import Groq from 'groq-sdk';
import { prisma } from '../../database/prisma.js';
import { ChatbotContext } from './chatbot.context.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export class IAService {
  private model = 'llama-3.3-70b-versatile'; 
  private contextHelper = new ChatbotContext();

  async generateResponse(session: any, userMessage: string, history: any[]) {
    const config = await prisma.chatbotConfig.findFirst({ where: { isActive: true } });

    const messages: any[] = [
      { 
        role: 'system', 
        content: config?.systemPrompt || 'Você é um vendedor especialista em suplementos esportivos da loja Havoc. Seja persuasivo, direto e use emojis. Sempre que o cliente quiser comprar algo ou ver os produtos, use a ferramenta de catálogo.' 
      },
      ...history.map(h => ({ role: h.role.toLowerCase(), content: h.content })),
      { role: 'user', content: userMessage }
    ];

    // ─── FERRAMENTAS (TOOLS) DO AGENTE ───
    const tools: Groq.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'consultar_catalogo_e_kits',
          description: 'Acione esta ferramenta sempre que o cliente quiser ver produtos, preços, promoções ou combos/kits de suplementos.',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'consultar_status_pedido',
          description: 'Acione esta ferramenta se o cliente perguntar "Onde está meu pedido?", "Já saiu para entrega?" etc.',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'solicitar_atendimento_humano',
          description: 'Acione esta ferramenta APENAS se o cliente exigir falar com um humano, atendente, fazer uma reclamação ou se estiver muito irritado.',
          parameters: { type: 'object', properties: {} }
        }
      }
    ];

    // Primeira chamada ao LLM
    const response = await groq.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: config?.temperature || 0.7,
    });

    const responseMessage = response.choices[0].message;
    let requiresHumanHandoff = false;

    // ─── PROCESSA A DECISÃO DO AGENTE ───
    if (responseMessage.tool_calls) {
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        let toolResult = '';

        if (functionName === 'consultar_catalogo_e_kits') {
          const menu = await this.contextHelper.getMenuContext();
          const kits = await this.contextHelper.getPromoKitsContext();
          toolResult = `${menu}\n${kits}`;
        } 
        else if (functionName === 'consultar_status_pedido') {
          toolResult = await this.contextHelper.getOrderStatus(session.sessionKey); // sessionKey é o telefone
        }
        else if (functionName === 'solicitar_atendimento_humano') {
          requiresHumanHandoff = true;
          toolResult = 'Ação concluída. Informe ao cliente que ele será transferido.';
        }

        messages.push(responseMessage);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }

      // Chama a IA de novo para ela formular a resposta final humanizada baseada nos dados
      const finalResponse = await groq.chat.completions.create({
        model: this.model,
        messages,
      });

      return {
        content: finalResponse.choices[0].message.content,
        tokens: finalResponse.usage?.total_tokens || 0,
        handoff: requiresHumanHandoff
      };
    }

    // Se a IA não usou ferramenta (ex: só respondeu um "Bom dia!")
    return {
      content: responseMessage.content,
      tokens: response.usage?.total_tokens || 0,
      handoff: false
    };
  }
}