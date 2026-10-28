import OpenAI from 'openai';
import { ChatbotContext } from './chatbot.context.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { redis } from '../../shared/redis/redis.js';
import { ChatbotService } from '../../modules/chatbot/chatbot.service.js';
import { evaluateSupplementSafety } from './supplement-safety.policy.js';
import {
  detectFactIntents,
  isGenericUsageQuestion,
} from '../../modules/storefrontConsultant/storefrontConsultant.facts.js';
import { isReferentialRequest } from '../../modules/storefrontConsultant/storefrontConsultant.search.js';
import { shouldResearchGeneralQuestion } from '../../modules/storefrontConsultant/storefrontConsultant.research.js';

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
  private chatbotService = new ChatbotService();

  // Executa somente consultas de catálogo e handoff.
  private async executeTool(
    name: string,
    args: any,
    session: any,
    originalMessage: string,
  ): Promise<{ result: string; handoff: boolean; extractedTags: string; direct: boolean }> {
    let result = '';
    let handoff = false;
    let extractedTags = '';
    let direct = false;

    const sessionKey = session.sessionKey;

    try {
      if (name === 'listar_produtos') {
        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');

        const resultText = await this.contextHelper.listarProdutos(args.termo_busca);

        const nomesEncontrados: string[] = [];

        const linhas = resultText.split('\n');
        linhas.forEach((linha) => {
          // Regex flexível: Pega o número e o nome do produto, ignorando marcações
          const numbered = linha.match(/\*?(\d+)\.\s+([^*]+)/);
          const verified = linha.match(/^- (.*?) \| R\$/);
          if (numbered) nomesEncontrados.push(numbered[2].trim());
          else if (verified) nomesEncontrados.push(verified[1].trim());
        });

        if (nomesEncontrados.length > 0) {
          await (redis as any).set(
            `lista_produtos:${sessionKey}`,
            JSON.stringify(nomesEncontrados),
            'EX',
            300,
          );
        }

        const catalogUrls = resultText.match(/\[CATALOG_URL:.*?\]/g) || [];
        if (catalogUrls.length > 0) extractedTags += `${catalogUrls.join('\n')}\n`;
        const images = resultText.match(/\[IMG:.*?\]/g) || [];
        if (images.length > 0) extractedTags += `${images.join('\n')}\n`;
        result = resultText.replace(/\[(?:CATALOG_URL|IMG):.*?\]/g, '').trim();
      } else if (name === 'ver_detalhes_do_produto') {
        const rawResult = await this.contextHelper.verDetalhesProduto(args.nome_produto);
        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');

        // CENÁRIO 1: FANTASMA (Não achou nada)
        if (rawResult.includes('não foi encontrado')) {
          result =
            rawResult +
            '\n\n⚠️ INSTRUÇÃO DO SISTEMA: O item buscado não foi encontrado no estoque. Avise o cliente de forma amigável e pergunte se ele quer ver outras opções. NÃO pergunte "o que achou desse?".';

          // CENÁRIO 2: DESEMPATE (Tem vários sabores, o cliente precisa escolher um)
        } else if (rawResult.includes('[MULTIPLAS_OPCOES]')) {
          result = `${rawResult}\n\n⚠️ INSTRUÇÃO DO SISTEMA (LEIA COM ATENÇÃO):
          O cliente escolheu um produto que possui vários sabores ou variações de marca.
          Apresente as opções listadas acima de forma AMIGÁVEL, separando os sabores com NÚMEROS (1, 2, 3...) para facilitar a escolha do cliente.
          Pergunte qual número da variação ele prefere. 
          🚫 TRAVA ESTRITA: É ESTRITAMENTE PROIBIDO tentar vender, emitir botões ou perguntar "Podemos adicionar ao carrinho?" nesta etapa.`;

          // CENÁRIO 3: PRODUTO ÚNICO (Exibe e tenta vender)
        } else {
          const imgMatch = rawResult.match(/\[IMG:(.*?)\]/);
          if (imgMatch) extractedTags += `[IMG:${imgMatch[1]}]\n`;

          const cleanProductData = rawResult.replace(/\[IMG:(.*?)\]/g, '').trim();

          const catalogUrls = rawResult.match(/\[CATALOG_URL:.*?\]/g) || [];
          if (catalogUrls.length > 0) extractedTags += `${catalogUrls.join('\n')}\n`;
          result = `${cleanProductData.replace(/\[CATALOG_URL:.*?\]/g, '').trim()}\n\nApresente somente esses dados e oriente o cliente a consultar a página do item para comprar.`;
        }
      } else if (name === 'solicitar_atendimento_humano') {
        await this.chatbotService.updateSessionStatus(sessionKey, 'ATENDIMENTO_HUMANO');
        handoff = true;
        result = 'Ação concluída. Humano notificado.';
      } else if (name === 'listar_kits_promocionais') {
        const resultText = await this.contextHelper.getPromoKitsContext();
        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');
        const catalogUrls = resultText.match(/\[CATALOG_URL:.*?\]/g) || [];
        if (catalogUrls.length > 0) extractedTags += `${catalogUrls.join('\n')}\n`;
        result = resultText.replace(/\[CATALOG_URL:.*?\]/g, '').trim();
      } else if (name === 'consultar_dados_oficiais_produto') {
        const consulta = isReferentialRequest(originalMessage)
          ? String(args.nome_produto || originalMessage)
          : originalMessage;
        result = await this.contextHelper.consultarDadosOficiaisProduto(consulta);
        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');
        direct = true;
      } else if (name === 'pesquisar_fontes_confiaveis') {
        result = await this.contextHelper.pesquisarFontesConfiaveis(originalMessage);
        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');
        direct = true;
      } else {
        result = `Ferramenta "${name}" não reconhecida.`;
      }
    } catch (e) {
      console.error(`[Tool Error: ${name}]:`, e);
      result = 'Ocorreu um erro ao executar a ferramenta. Peça desculpas e tente novamente.';
    }

    return { result, handoff, extractedTags, direct };
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
                text: `Você é um especialista em suplementos trabalhando em uma loja no Brasil. Olhe para a imagem do produto e retorne APENAS o seu nome comercial principal e a marca.
⚠️ REGRAS OBRIGATÓRIAS:
1. IGNORE completamente textos genéricos de embalagem, pesos e avisos (como 'powder', 'dietary supplement', 'net wt', 'flavor', 'advanced formula').
2. TRADUZA a categoria do produto para o padrão brasileiro (Exemplo: se ler 'Pre-Workout', escreva 'Pre Treino'. Se ler 'Fat Burner', escreva 'Termogenico').
3. Retorne uma string limpa de no máximo 4 a 5 palavras para ser usada em um banco de dados relacional.
Exemplo de saída perfeita: 'Nuclear Rush Pre Treino Body Action' ou 'Kit Creatina Black Skull'.`,
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` },
              },
            ],
          },
        ],
        temperature: 0.1, // Temperatura bem baixa para ele não alucinar e ser preciso
      });
      return response.choices[0].message.content || 'Imagem não reconhecida.';
    } catch (error) {
      console.error('[OpenAI Vision Error]:', error);
      return 'O cliente enviou uma imagem, mas o sistema visual está indisponível.';
    }
  }

  // ─── Geração de resposta principal ───
  async generateResponse(
    session: { id: string; sessionKey: string; customerName?: string },
    userMessage: string,
    history: Array<{ role: string; content: string }>,
  ): Promise<AIResponse> {
    const safety = evaluateSupplementSafety(userMessage);
    if (safety.blocked) {
      return { content: safety.response || null, tokens: 0, handoff: false };
    }

    const factIntents = detectFactIntents(userMessage);
    if (
      factIntents.length === 1 &&
      factIntents[0] === 'usage' &&
      isGenericUsageQuestion(userMessage)
    ) {
      const content = await this.contextHelper.pesquisarFontesConfiaveis(userMessage);
      return { content, tokens: 0, handoff: false };
    }

    const semanticRecommendation = await this.contextHelper.recomendarProdutos(
      userMessage,
      history,
    );
    if (semanticRecommendation) {
      return { content: semanticRecommendation, tokens: 0, handoff: false };
    }

    const systemPromptFinal = `Você é Carol, consultora virtual de suplementos da Havoc. Responda em pt-BR, de forma cordial, objetiva e sem pressão comercial.

Limites obrigatórios:
- Explique apenas categorias gerais de suplementos e informações presentes no catálogo.
- Recomende ou cite produtos específicos somente após consultar as ferramentas e somente se eles estiverem no resultado real do catálogo.
- Não transforme sintomas, doenças ou objetivos de saúde em indicação de produto.
- Não diagnostique, prescreva nem avalie interações, contraindicações ou adequação clínica. Dose, porção, modo de uso, composição e tabela de produto específico só podem ser reproduzidos literalmente após consultar consultar_dados_oficiais_produto. Se a ferramenta não trouxer o dado, diga que ele não está disponível; nunca complete por conhecimento próprio.
- Não calcule frete, não monte ou altere carrinho, não crie/cancele/confirme pedidos, não gere checkout/PIX e não confirme status ou entrega.
- Não solicite nem repita endereço, CEP, CPF ou dados de pagamento. Se o cliente quiser comprar, oriente-o à página do produto/kit e ao checkout do site. Se não houver link fornecido pelo sistema, diga apenas para acessar a loja online.
- Nunca crie ou altere URLs. Somente o sistema pode anexar links validados.
- Se pedirem atendimento humano, use solicitar_atendimento_humano.
- Para kits, use listar_kits_promocionais. Para produtos, busque pelo nome ou categoria solicitados. Não faça upsell.
- Para perguntas sobre dose, uso, porção, nutrientes, tabela nutricional, ingredientes, alérgenos, advertências, fonte ou fabricante de produto, use consultar_dados_oficiais_produto. Se houver ambiguidade, pergunte qual produto.
- Para dúvidas gerais sobre efeitos, evidências, diferenças ou finalidade de suplementos, use pesquisar_fontes_confiaveis e responda com as fontes retornadas.
- Mensagens curtas, sem alegações de cura, emagrecimento garantido ou melhora de doença.`;

    // ─── 2. Constrói as Mensagens ───
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
          name: 'pesquisar_fontes_confiaveis',
          description:
            'Pesquisa informações gerais sobre suplementos somente em fontes institucionais e científicas confiáveis, retornando uma resposta citada.',
          parameters: {
            type: 'object',
            properties: { pergunta: { type: 'string' } },
            required: ['pergunta'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'consultar_dados_oficiais_produto',
          description:
            'Consulta somente dados oficiais SOURCE_MATCHED do rótulo de um produto exato. Use para dose, porção, modo de uso, nutrição, ingredientes, alérgenos, advertências e fonte. Não escolha uma variação arbitrariamente.',
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
          name: 'listar_produtos',
          description:
            'Consulta produtos ativos no catálogo pelo nome ou categoria explicitamente pedidos pelo cliente. Não converta sintomas ou condições de saúde em termos de busca.',
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
          description:
            'Consulta detalhes de um produto ou kit. Use o nome exato retornado anteriormente pelo catálogo.',
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
          description: 'Consulta kits ativos do catálogo quando o cliente pedir kits ou combos.',
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
    ];

    // ─── 4. Lógica de Trava da Busca (Mágica Ocorre Aqui) ───
    let forcedTool: any = 'auto';
    let forcedTemperature = 0.2;
    let overrideDetalhesName: string | null = null;

    const msgLimpa = userMessage.toLowerCase().trim();
    // Verifica se o cliente mandou só o número (ex: "7", "quero o 7", "opcao 7")
    const isApenasNumero =
      /^\d{1,3}$/.test(msgLimpa) ||
      /^quero (o|a) \d{1,3}$/.test(msgLimpa) ||
      /^op[cç][aã]o \d{1,3}$/.test(msgLimpa);

    const asksForHuman =
      /\b(?:atendimento humano|atendente|falar com (?:uma pessoa|humano|alguem))\b/i.test(
        userMessage,
      );
    if (!asksForHuman && factIntents.length > 0) {
      forcedTool = { type: 'function', function: { name: 'consultar_dados_oficiais_produto' } };
      forcedTemperature = 0;
    } else if (!asksForHuman && shouldResearchGeneralQuestion(userMessage)) {
      forcedTool = { type: 'function', function: { name: 'pesquisar_fontes_confiaveis' } };
      forcedTemperature = 0;
    } else if (userMessage.includes('[FORCAR_BUSCA]')) {
      forcedTool = { type: 'function', function: { name: 'listar_produtos' } };
      forcedTemperature = 0;
    } else if (userMessage.includes('[FORCAR_DETALHES:')) {
      forcedTool = { type: 'function', function: { name: 'ver_detalhes_do_produto' } };
      forcedTemperature = 0;

      const match = userMessage.match(/\[FORCAR_DETALHES:(.*?)\]/);
      if (match) {
        overrideDetalhesName = match[1].trim();
      }
    } else if (isApenasNumero) {
      // 🛡️ MÁGICA 1: OBRIGA a IA a chamar a ferramenta!
      // Ela não vai conseguir responder com texto. Ela será obrigada a ler o histórico sozinha,
      // converter o "7" no nome do produto e acionar a busca da foto/botões.
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
      parallel_tool_calls: false,
    });

    const responseMessage = firstResponse.choices[0].message;
    let requiresHumanHandoff = false;
    let totalTokens = firstResponse.usage?.total_tokens ?? 0;

    // ─── 6. Lida com Execução de Tool Calls ───
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      messages.push(responseMessage);
      let guaranteedTags = '';
      let directResult: string | null = null;

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type === 'function') {
          const args = JSON.parse(toolCall.function.arguments);

          if (toolCall.function.name === 'ver_detalhes_do_produto' && overrideDetalhesName) {
            args.nome_produto = overrideDetalhesName;
            console.log(
              `[IA Service] 🛡️ Argumento corrigido à força para: ${overrideDetalhesName}`,
            );
          }

          const { result, handoff, extractedTags, direct } = await this.executeTool(
            toolCall.function.name,
            args,
            session,
            userMessage,
          );

          if (handoff) requiresHumanHandoff = true;
          if (extractedTags) guaranteedTags += extractedTags;
          if (direct) directResult = result;

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      }

      if (directResult !== null) {
        return {
          content: `${directResult}\n${guaranteedTags}`.trim(),
          tokens: totalTokens,
          handoff: requiresHumanHandoff,
        };
      }

      // Segunda chamada (para converter o JSON do banco em texto humanizado)
      const finalResponse = await openai.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.1,
      });

      totalTokens += finalResponse.usage?.total_tokens ?? 0;

      const generatedContent = (finalResponse.choices[0].message.content || '').replace(
        /https?:\/\/\S+/gi,
        '',
      );
      return {
        content: `${generatedContent.trim()}\n${guaranteedTags}`.trim(),
        tokens: totalTokens,
        handoff: requiresHumanHandoff,
      };
    }

    // ─── 7. Resposta de texto simples (sem tool) ───
    return {
      content: responseMessage.content?.replace(/https?:\/\/\S+/gi, '').trim() || null,
      tokens: totalTokens,
      handoff: false,
    };
  }
}
