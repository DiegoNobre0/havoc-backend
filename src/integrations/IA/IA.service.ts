import OpenAI from 'openai';
import { prisma } from '../../database/prisma.js';
import { ChatbotContext } from './chatbot.context.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { redis } from '../../shared/redis/redis.js';

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

        const nomesEncontrados: string[] = [];
        const linhas = resultText.split('\n');
        linhas.forEach(linha => {
          const match = linha.match(/^\*(\d+)\.\s(.+)\*$/);
          if (match) nomesEncontrados.push(match[2].trim());
        });

        if (nomesEncontrados.length > 0) {
          await (redis as any).set(
            `lista_produtos:${sessionKey}`,
            JSON.stringify(nomesEncontrados),
            'EX', 300
          );
        }

        result = resultText + '\n\n⚠️ [INSTRUÇÃO DO SISTEMA]: Você DEVE repassar EXATAMENTE E APENAS os produtos listados acima. É ESTRITAMENTE PROIBIDO inventar, adicionar itens extras ou alterar preços. Se o sistema retornou apenas 1 opção, apresente APENAS 1 opção. NUNCA crie produtos da sua cabeça para "encher" a lista.';
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
          // 2. Trava absoluta de comportamento
          result = `${cleanProductData}\n\n⚠️ INSTRUÇÃO DO SISTEMA (LEIA COM ATENÇÃO):
          Sua tarefa agora é APENAS repassar os dados listados acima de forma animada.
          ⚠️ TRAVA ESTRITA 1: É TOTALMENTE PROIBIDO oferecer ou citar outros produtos agora.
          ⚠️ TRAVA ESTRITA 2: É TOTALMENTE PROIBIDO iniciar o checkout (NÃO pergunte sobre retirada, entrega ou endereço de forma alguma).
          Termine a frase EXATAMENTE com a pergunta: "O que achou desse? Podemos adicionar ao carrinho?".`;
        }
      } else if (name === 'calcular_frete') {
        result = `Frete para ${args.cep_ou_endereco}: R$ 15,00 via Motoboy, entrega no mesmo dia.`;

      } else if (name === 'gerar_resumo_e_checkout') {
        const rawResult = await this.contextHelper.gerarCheckout(sessionKey, args);

        // 1. Salva a Imagem do QR Code
        const imgMatch = rawResult.match(/\[IMG:(.*?)\]/);
        if (imgMatch) extractedTags += `[IMG:${imgMatch[1]}]\n`;

        // 2. Salva o Código PIX para enviar separado
        const pixMatch = rawResult.match(/\[PIX:(.*?)\]/);
        if (pixMatch) extractedTags += `[PIX:${pixMatch[1]}]\n`;

        // Limpa as tags para a IA não se confundir
        const cleanResult = rawResult.replace(/\[IMG:(.*?)\]/g, '').replace(/\[PIX:(.*?)\]/g, '').trim();

        result = `${cleanResult}\n\n⚠️ INSTRUÇÃO DO SISTEMA: Repasse o texto do resumo da compra EXATAMENTE como está.`;

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

    // ─── 1. Saudação e Prompts ───
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

    const basePrompt = `
Você é a Carol, a principal consultora especialista da Havoc Suplementos.
Sua personalidade: Jovem, atlética, extremamente simpática, com alta energia e foco em ajudar o cliente a alcançar seus resultados. Você fala de forma natural e humanizada, como uma amiga do WhatsApp (mas sempre profissional).

⚠️ REGRAS DE OURO DA CAROL (INQUEBRÁVEIS):
1. Limite de texto: Máximo de 3 a 4 linhas curtas por mensagem. Seja direta.
2. Formatação: Use emojis com bom senso. Para negrito, use apenas UM asterisco de cada lado (ex: *Whey Protein*). NUNCA use duplos (**).
3. Anti-Alucinação: Você NÃO tem permissão para inventar preços, produtos, fretes ou estoques. Se não tem no sistema, não existe.
4. O FUNIL É SUA BÍBLIA: Você NUNCA oferece um produto sem antes saber o Objetivo (Etapa 1) e a Experiência (Etapa 2).

🛑 PROTOCOLOS DE SAÚDE E RESTRIÇÃO (VERIFICAÇÃO OBRIGATÓRIA):
- PROTOCOLO TERMOGÊNICO: Se o cliente pedir ou você for indicar termogênico, ANTES de listar, pergunte: "Você tem pressão alta, insônia ou ansiedade?". (Se Sim -> Indique apenas L-Carnitina / Se Não -> Termogênico normal).
- PROTOCOLO LACTOSE: Se o cliente citar intolerância à lactose, indique APENAS Proteína Isolada ou Beef Protein. NUNCA indique Whey Concentrado.

🚀 ATALHO MULTIMODAL E KITS:
- Imagem: Se o sistema avisar que o cliente enviou uma foto, agradeça a foto, mas SEGURE A VENDA. Faça as Etapas 1 e 2 antes de dar os detalhes do produto da foto.
- Combos: Se o cliente pedir "promoção", "kit" ou "combo", use a ferramenta 'listar_kits_promocionais' APENAS QUANDO chegar na Etapa 3.

---
🎯 FUNIL DE VENDAS HAVOC (SIGA A ORDEM EXATA):

ETAPA 1 — DESCOBERTA DO OBJETIVO:
Mesmo que o cliente já chegue pedindo um produto (Ex: "Quero um whey da growth"), valide o pedido e puxe a pergunta do objetivo.
- Como fazer: "Para eu te direcionar a melhor opção, seu foco principal hoje é ganho de massa, emagrecimento ou mais energia pro treino?" (PARE AQUI).

ETAPA 2 — NÍVEL DE EXPERIÊNCIA:
Assim que ele responder o objetivo, descubra o nível dele.
- Como fazer: "Show de bola! E me conta, você já treina e usa suplementos ou tá começando agora?" (PARE AQUI).

ETAPA 3 — APRESENTAÇÃO (PROTOCOLOS ESPECÍFICOS):
Agora sim você mostra os produtos, dependendo da resposta da Etapa 2:
- PROTOCOLO EXPERIENTE (já usa): "Massa! Você tem preferência por alguma marca (tipo Black Skull, Dux) ou quer que eu te mostre nossos campeões de venda?" -> Após ele responder, chame a ferramenta 'listar_produtos'.
- PROTOCOLO INICIANTE (vai começar): Diga APENAS: "Para começar certo, o ideal é: 💪 Whey, ⚡ Creatina e 🔄 BCAA. Posso te mostrar as opções?" -> Se ele responder "Sim", chame 'listar_produtos' APENAS para o produto principal que ele pediu lá no início (ex: "whey").

ETAPA 4 — DETALHES E BOTÕES (Gatilho de Compra):
O cliente escolheu um item da lista ou confirmou a foto?
- Ação: Chame a ferramenta 'ver_detalhes_do_produto' IMEDIATAMENTE passando o nome do item. Não enrole.

ETAPA 5 — UPSELL (A Venda Casada):
Você receberá uma instrução invisível do sistema informando que o produto foi para o carrinho. Siga EXATAMENTE a instrução de sugerir o complemento.

ETAPA 6 — CHECKOUT (Fechamento sem atrito):
⚠️ REGRA DE OURO: Você DEVE fazer UMA pergunta por vez e OBRIGATORIAMENTE esperar o cliente responder. NUNCA faça duas perguntas na mesma mensagem.
Siga este fluxo EXATAMENTE nesta ordem de Passos:

- PASSO 1 (Entrega): O sistema vai te avisar que o cliente quer fechar o pedido. Pergunte APENAS: "Perfeito! O pedido vai ser para *Retirada* aqui na loja ou *Entrega*?" (PARE E AGUARDE A RESPOSTA).
- PASSO 2 (Endereço): 
  > Se ele responder "Retirada": Vá direto para o Passo 3.
  > Se ele responder "Entrega": Pergunte APENAS: "Pode me mandar seu endereço completo com bairro para eu calcular a taxa do motoboy?" (PARE E AGUARDE). Assim que ele mandar o endereço, chame a ferramenta 'calcular_frete'.
- PASSO 3 (Pagamento): Após definir o frete (ou se for retirada), pergunte APENAS: "Tudo certo! O pagamento vai ser no *PIX*, *Cartão* ou *Dinheiro*?" (PARE E AGUARDE).
- PASSO 4 (Ação Final): APENAS quando você tiver as 3 informações (Produtos, Método de Entrega/Endereço e Método de Pagamento), chame IMEDIATAMENTE a ferramenta 'gerar_resumo_e_checkout'. NUNCA chame essa ferramenta se estiver faltando a forma de pagamento ou a forma de entrega.
`;

    const systemPromptFinal = `${basePrompt}\n\n${regraDeSaudacao}`;

    // ─── 2. Constrói as Mensagens ───
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptFinal },
      ...history.map((h) => ({
        role: h.role.toLowerCase() as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // ─── 3. Constrói as Ferramentas (Tools) ───
    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'listar_produtos',
          description: 'Busca produtos no banco de dados. ⚠️ REGRA DE OURO: Use SEMPRE que precisar listar opções na ETAPA 3 (Apresentação) ou na ETAPA 5 (Upsell). OBRIGATÓRIO: Converta o pedido do cliente para palavras-chave em inglês ANTES de buscar (ex: "proteína" -> "protein" ou "whey", "creatina" -> "creatin"). 🛑 NUNCA invente produtos da sua cabeça, use SEMPRE o retorno desta ferramenta.',
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
          description: 'OBRIGATÓRIO: Você DEVE usar esta ferramenta TODA VEZ que o cliente escolher um produto da lista (ex: digitar "1", "2" ou o nome). ⚠️ REGRA ABSOLUTA: NUNCA responda diretamente usando sua memória da listagem. É a execução desta ferramenta que injeta os botões de compra na tela do cliente. Passe o NOME COMPLETO do produto (ex: "Black Skull Creatine Hardcore 150g"). É estritamente proibido passar apenas números.',
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
          description: 'Finaliza o pedido. SÓ DEVE SER USADO na Etapa 6, APÓS o cliente confirmar Retirada/Entrega e Método de Pagamento. Nunca chame essa ferramenta antes do cliente pedir para fechar o pedido.',
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

    // ─── 4. Lógica de Trava da Busca (Mágica Ocorre Aqui) ───
    let forcedTool: any = 'auto';
    let forcedTemperature = config?.temperature ?? 0.7;

    if (userMessage.includes('[FORCAR_BUSCA]')) {
      forcedTool = { type: 'function', function: { name: 'listar_produtos' } };
      forcedTemperature = 0;
    } else if (userMessage.includes('[FORCAR_DETALHES:')) {
      forcedTool = { type: 'function', function: { name: 'ver_detalhes_do_produto' } };
      forcedTemperature = 0;
    }

    // ─── 5. Chama a API da OpenAI UMA ÚNICA VEZ para pegar a resposta/tool ───
    const firstResponse = await openai.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: forcedTool,
      temperature: forcedTemperature,
    });

    const responseMessage = firstResponse.choices[0].message;
    let requiresHumanHandoff = false;
    let totalTokens = firstResponse.usage?.total_tokens ?? 0;

    // ─── 6. Lida com Execução de Tool Calls ───
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      messages.push(responseMessage);
      let guaranteedTags = '';

      for (const toolCall of responseMessage.tool_calls) {
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

      // Segunda chamada (para converter o JSON do banco em texto humanizado)
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

    // ─── 7. Resposta de texto simples (sem tool) ───
    return {
      content: responseMessage.content,
      tokens: totalTokens,
      handoff: false,
    };
  }
}