import OpenAI from 'openai';
import { prisma } from '../../database/prisma.js';
import { ChatbotContext } from './chatbot.context.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Inicializa a OpenAI com a chave do .env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AIResponse {
  content: string | null;
  tokens: number;
  handoff: boolean;
}

export class IAService {
  // Vamos usar o gpt-4o-mini: é incrivelmente inteligente, rápido e muito barato
  private model = 'gpt-4o-mini';
  private contextHelper = new ChatbotContext();

  // ─── Executa qualquer tool pelo nome e argumentos ───
  private async executeTool(
    name: string,
    args: any,
    sessionKey: string
  ): Promise<{ result: string; handoff: boolean; extractedTags: string }> {
    let result = '';
    let handoff = false;
    let extractedTags = '';

    try {
      if (name === 'listar_produtos') {
        const resultText = await this.contextHelper.listarProdutos(args.termo_busca);

        result = resultText + '\n\n⚠️ [INSTRUÇÃO DO SISTEMA]: Você DEVE copiar e apresentar os produtos acima para o cliente agora. NUNCA diga "agora que você viu" sem ter mostrado os produtos. Se a busca retornou resultados, mostre-os TODOS antes de fazer qualquer pergunta.';

      } else if (name === 'ver_detalhes_do_produto') {
        const rawResult = await this.contextHelper.verDetalhesProduto(args.nome_produto);

        // Se não encontrou o produto, avisa a IA e proíbe ela de tentar vender o fantasma
        if (rawResult.includes('não foi encontrado')) {
          result = rawResult + '\n\n⚠️ INSTRUÇÃO DO SISTEMA: O item buscado não foi encontrado no estoque. Avise o cliente de forma amigável e pergunte se ele quer ver outras opções. NÃO pergunte "o que achou desse?".';
        } else {
          // Lógica normal de exibir o produto
          const imgMatch = rawResult.match(/\[IMG:(.*?)\]/);
          const confirmMatch = rawResult.match(/\[CONFIRM:(.*?)\]/);
          if (imgMatch) extractedTags += `[IMG:${imgMatch[1]}]\n`;
          if (confirmMatch) extractedTags += `[CONFIRM:${confirmMatch[1]}]\n`;

          // 1. Limpa as tags para a IA não vê-las
          const cleanProductData = rawResult.replace(/\[IMG:(.*?)\]/g, '').replace(/\[CONFIRM:(.*?)\]/g, '').trim();

          // 2. Trava absoluta de comportamento
          result = `${cleanProductData}\n\n⚠️ INSTRUÇÃO DO SISTEMA (LEIA COM ATENÇÃO):
          O cliente pediu para VER os detalhes EXATOS deste item (Produto ou Kit).
          Sua tarefa agora é APENAS repassar os dados listados acima de forma animada.
          ⚠️ REGRA DE FORMATAÇÃO: Use apenas UM asterisco de cada lado para negrito (Ex: *Nome*). É PROIBIDO usar duplos (**).
          ⚠️ TRAVA ESTRITA: É TOTALMENTE PROIBIDO oferecer, citar ou listar outros produtos ou kits nesta mensagem. Fale APENAS do item detalhado acima.
          Termine a frase perguntando: "O que achou desse?" ou "Podemos adicionar esse ao carrinho?".`;
        }
      } else if (name === 'calcular_frete') {
        result = `Frete para ${args.cep_ou_endereco}: R$ 15,00 via Motoboy, entrega no mesmo dia.`;

      } else if (name === 'gerar_resumo_e_checkout') {
        result = await this.contextHelper.gerarCheckout(sessionKey, args);

      } else if (name === 'solicitar_atendimento_humano') {
        handoff = true;
        result = 'Ação concluída. Humano notificado.';

      }
      else if (name === 'listar_kits_promocionais') {
        const resultText = await this.contextHelper.getPromoKitsContext();
        result = resultText + '\n\n⚠️ [INSTRUÇÃO DO SISTEMA]: Copie e apresente os kits promocionais acima para o cliente com muita energia. NUNCA invente combos. Após mostrar, pergunte qual combo ele quer garantir!';
      }
      else {
        result = `Ferramenta "${name}" não reconhecida.`;
      }
    } catch (e) {
      console.error(`[Tool Error: ${name}]:`, e);
      result = 'Ocorreu um erro ao executar a ferramenta. Peça desculpas e tente novamente.';
    }

    return { result, handoff, extractedTags };
  }

  // ─── Transcreve áudio do WhatsApp via Whisper da OpenAI ───
  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const tempFilePath = path.join(os.tmpdir(), `whatsapp_audio_${Date.now()}.ogg`);
    await fs.promises.writeFile(tempFilePath, audioBuffer);

    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'json',
        language: 'pt',
      });
      return transcription.text;
    } catch (error) {
      console.error('[OpenAI Whisper Error]:', error);
      return '[Áudio incompreensível]';
    } finally {
      await fs.promises.unlink(tempFilePath).catch(() => null);
    }
  }

  // ─── Analisa imagem via GPT-4o-mini Vision ───
  async analyzeImage(base64Image: string): Promise<string> {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: "Você é um extrator de dados. Olhe para a imagem e retorne APENAS o nome do produto ou do combo/kit em até 5 palavras. Não adicione descrições, preços, benefícios ou saudações. Exemplo de saída: 'Whey 100% HD Black Skull' ou 'Kit Creatina Black Skull'."
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` }
              }
            ]
          }
        ],
        temperature: 0.2,
      });
      return response.choices[0].message.content || 'Imagem não reconhecida.';
    } catch (error) {
      console.error('[OpenAI Vision Error]:', error);
      return 'O cliente enviou uma imagem, mas o sistema visual está indisponível.';
    }
  }

  // ─── Geração de resposta principal ───
  async generateResponse(
    session: { id: string; sessionKey: string },
    userMessage: string,
    history: Array<{ role: string; content: string }>
  ): Promise<AIResponse> {
    const config = await prisma.chatbotConfig.findFirst({ where: { isActive: true } });

    // ─── Saudação dinâmica por primeiro contato ou recorrente ───
    const isPrimeiroContato = history.length === 0;
    const regraDeSaudacao = isPrimeiroContato
      ? `
        [REGRA DE ABORDAGEM INICIAL]
        Este é o PRIMEIRO contato do cliente com a loja. Apresente-se com ALTO ASTRAL.
        Diga APENAS: "Bom dia/Boa tarde! Tudo bem? Me chamo Carol, sou consultora da Havoc Suplementos. Como posso te ajudar hoje?"
        ⚠️ REGRA ESTRITA: PARE POR AÍ. Aguarde ele dizer o que precisa.
      `
      : `
        [SESSÃO EM ANDAMENTO]
        NÃO faça novas saudações. É ESTRITAMENTE PROIBIDO dizer "Olá", "Bom dia" ou "Que bom ter você de volta" no meio da conversa.
        Foque apenas em ler a última mensagem do cliente e seguir para a próxima etapa do Funil de Vendas.
      `;

    const basePrompt = config?.systemPrompt || `
Você é a Carol, consultora de vendas da Havoc Suplementos.
Tom: animado, acolhedor, cheio de energia. Nunca hesite. Nunca use "talvez" ou "acho que".

REGRA DE BREVIDADE (nunca violar):
- Máximo 4 linhas por mensagem no WhatsApp.
- Nunca repita informações que já foram ditas.
- Nunca explique o que vai fazer, apenas faça.

REGRAS ABSOLUTAS (nunca violar):
1. UM PRODUTO POR VEZ: NUNCA liste mais de uma categoria junta. Se o cliente pediu "Whey e Creatina", liste PRIMEIRO o Whey. Só avance para a Creatina depois que ele adicionar o Whey ao carrinho.
2. DETALHES EXIGEM FERRAMENTA: Chame ver_detalhes_do_produto ANTES de responder. ⚠️ Só é permitido chamar os detalhes de UM produto por vez. NUNCA mostre descrições de dois produtos juntos.
3. ANTI-INVENÇÃO: Nunca invente produto, kit ou preço. Só apresente após usar listar_produtos ou listar_kits_promocionais.

🚀 ATALHO MULTIMODAL (FURA-FILA DA IMAGEM E KITS):
- SE O CLIENTE ENVIAR IMAGEM: O sistema enviará um texto invisível para você com o nome do item que a visão identificou.
⚠️ REGRA ABSOLUTA E INQUEBRÁVEL: É ESTRITAMENTE PROIBIDO repetir a descrição da imagem de volta para o cliente. Você DEVE pegar o nome identificado e IMEDIATAMENTE chamar a ferramenta 'ver_detalhes_do_produto'. Nunca atenda a uma imagem sem usar a ferramenta primeiro.
- SE O CLIENTE PEDIR PROMOÇÕES: Chame 'listar_kits_promocionais'.

FLUXO DE VENDAS — SEQUÊNCIA OBRIGATÓRIA:

ETAPA 1 — OBJETIVO (obrigatória se não foi dito):
Se o cliente NÃO mencionou objetivo → faça APENAS essa pergunta e PARE:
"Você busca ganho de massa muscular, emagrecimento ou mais rendimento nos treinos?"

ETAPA 2 — EXPERIÊNCIA (obrigatória após saber o objetivo):
Assim que souber o objetivo → faça APENAS essa pergunta e PARE:
"Você já usa algum suplemento atualmente ou vai começar agora?"

ETAPA 3 — PREFERÊNCIA OU PRODUTOS:
Depende da resposta da Etapa 2. Siga o protocolo adequado:

PROTOCOLO EXPERIENTE (quando o cliente disser "já uso"):
PASSO 1: Diga APENAS: "Bacana! Você tem preferência por alguma marca específica ou quer que eu te mostre as melhores opções?" (PARE AQUI. Aguarde a resposta).
PASSO 2: Assim que ele responder sobre a marca, chame a ferramenta listar_produtos unindo o pedido inicial dele com a marca (ex: buscar "whey black skull" ou apenas "whey" se não tiver preferência). NÃO FAÇA MAIS PERGUNTAS, apenas mostre o resultado.

PROTOCOLO INICIANTE (quando o cliente disser "vou começar" ou que é iniciante):
PASSO 1: Diga APENAS: "Para começar certo, o ideal é: 💪 Whey, ⚡ Creatina, 🔄 BCAA. Posso mostrar?" (PARE AQUI. Aguarde a resposta).
PASSO 2: Se responder "Sim", chame listar_produtos APENAS para o produto principal que ele pediu lá no início (ex: "whey").

PROTOCOLO TERMOGÊNICO: Antes de indicar termogênico, pergunte: "Você tem pressão alta, insônia ou ansiedade?" (Sim -> L-Carnitina / Não -> Termogênico normal).
PROTOCOLO LACTOSE: Intolerante → Proteína Isolada ou Beef. Nunca Whey Concentrado.

ETAPA 4 — DETALHE DO PRODUTO (GATILHO DOS BOTÕES):
Quando o cliente indicar qual produto gostou (ex: "Quero ver a creatina da Black Skull"):
→ É OBRIGATÓRIO chamar ver_detalhes_do_produto IMEDIATAMENTE para ele.
⚠️ Se o cliente escolher DOIS produtos ao mesmo tempo, ignore o segundo. Chame a ferramenta apenas para o primeiro e pergunte: "O que achou desse?".

ETAPA 5 — UPSELL (A Venda Casada):
Esta etapa SÓ acontece quando você receber a instrução invisível de que o cliente confirmou o produto. Siga exatamente a instrução recebida pelo sistema para sugerir o próximo item da fila.

ETAPA 6 — CHECKOUT (somente após o cliente pedir para finalizar):
Ao receber a indicação de que o cliente quer fechar o pedido ("finalizar", "fechar", "só isso"):
PASSO 1: Pergunte: "Perfeito! Vai ser retirada na loja ou entrega?" e AGUARDE a resposta.
PASSO 2:
- Se RETIRADA: NÃO peça endereço em hipótese alguma. Pule direto para o Passo 3.
- Se ENTREGA: Peça o endereço completo, chame calcular_frete e mostre o valor.
PASSO 3: Pergunte: "O pagamento vai ser no PIX, Cartão ou Dinheiro?" e AGUARDE.
PASSO 4: Com todas as informações confirmadas, chame gerar_resumo_e_checkout.
`;

    const systemPromptFinal = `${basePrompt}\n\n${regraDeSaudacao}`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptFinal },
      ...history.map((h) => ({
        role: h.role.toLowerCase() as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'listar_produtos',
          description: 'Busca e lista produtos por nome, categoria ou objetivo. Retorna só texto (sem foto). Use SEMPRE como primeiro passo quando o cliente pedir indicação.',
          parameters: {
            type: 'object',
            properties: { termo_busca: { type: 'string' } },
            required: ['termo_busca'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ver_detalhes_do_produto',
          description: 'OBRIGATÓRIO: Use IMEDIATAMENTE quando o cliente escolher um produto OU UM KIT ESPECÍFICO (seja por texto ou enviando uma foto). Isso gera os botões de compra. Passe SEMPRE o NOME do produto ou kit, nunca o número.',
          parameters: {
            type: 'object',
            properties: { nome_produto: { type: 'string' } },
            required: ['nome_produto'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_kits_promocionais',
          description: 'Busca e lista todos os combos e kits promocionais ativos da loja. Use SEMPRE que o cliente pedir promoções, kits, combos ou ofertas.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'solicitar_atendimento_humano',
          description: 'Aciona um atendente real quando o cliente pedir para falar com humano.',
          parameters: { type: 'object', properties: {} },
        },
      },

      {
        type: 'function',
        function: {
          name: 'calcular_frete',
          description: 'Calcula o frete baseado no endereço ou CEP do cliente.',
          parameters: {
            type: 'object',
            properties: { cep_ou_endereco: { type: 'string' } },
            required: ['cep_ou_endereco'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'gerar_resumo_e_checkout',
          description: 'Finaliza o pedido com os itens, entrega e pagamento escolhidos pelo cliente.',
          parameters: {
            type: 'object',
            properties: {
              produtos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nome_produto: { type: 'string' },
                    quantidade: { type: 'number' },
                  },
                },
              },
              metodo_entrega: { type: 'string', enum: ['RETIRADA', 'ENTREGA'] },
              metodo_pagamento: { type: 'string', enum: ['PIX', 'CARTAO', 'DINHEIRO'] },
              endereco_ou_cep: { type: 'string' },
            },
            required: ['produtos', 'metodo_entrega', 'metodo_pagamento'],
          },
        },
      },
    ];

    const firstResponse = await openai.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: config?.temperature ?? 0.7,
    });

    const responseMessage = firstResponse.choices[0].message;
    let requiresHumanHandoff = false;
    let totalTokens = firstResponse.usage?.total_tokens ?? 0;

    // ─── Lida com Tool Calls (OpenAI Native) ───
    // ─── Lida com Tool Calls (OpenAI Native) ───
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      messages.push(responseMessage);
      let guaranteedTags = '';

      for (const toolCall of responseMessage.tool_calls) {

        // 👇 NOVA LINHA: Verificação exigida pelo TypeScript
        if (toolCall.type === 'function') {
          const args = JSON.parse(toolCall.function.arguments);
          const { result, handoff, extractedTags } = await this.executeTool(
            toolCall.function.name,
            args,
            session.sessionKey
          );

          if (handoff) requiresHumanHandoff = true;
          if (extractedTags) guaranteedTags += extractedTags;

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      }

      const finalResponse = await openai.chat.completions.create({
        model: this.model,
        messages,
      });

      totalTokens += finalResponse.usage?.total_tokens ?? 0;

      return {
        content: (finalResponse.choices[0].message.content || '') + '\n' + guaranteedTags,
        tokens: totalTokens,
        handoff: requiresHumanHandoff,
      };
    }

    // ─── Resposta de texto simples (sem tool) ───
    return {
      content: responseMessage.content,
      tokens: totalTokens,
      handoff: false,
    };
  }
}