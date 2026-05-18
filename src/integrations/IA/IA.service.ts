import OpenAI from 'openai';
import { prisma } from '../../database/prisma.js';
import { ChatbotContext } from './chatbot.context.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { redis } from '../../shared/redis/redis.js';
import { ChatbotService } from '../../modules/chatbot/chatbot.service.js';

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

  // ─── Executa qualquer tool pelo nome e argumentos ───
  private async executeTool(
    name: string,
    args: any,
    session: any
  ): Promise<{ result: string; handoff: boolean; extractedTags: string }> {
    let result = '';
    let handoff = false;
    let extractedTags = '';

    const sessionKey = session.sessionKey;

    try {
      if (name === 'listar_produtos') {

        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');

        const resultText = await this.contextHelper.listarProdutos(args.termo_busca);

        const nomesEncontrados: string[] = [];

        const linhas = resultText.split('\n');
        linhas.forEach(linha => {
          // Regex flexível: Pega o número e o nome do produto, ignorando marcações
          const match = linha.match(/\*?(\d+)\.\s+([^\*]+)/);
          if (match) nomesEncontrados.push(match[2].trim());
        })

        if (nomesEncontrados.length > 0) {
          await (redis as any).set(
            `lista_produtos:${sessionKey}`,
            JSON.stringify(nomesEncontrados),
            'EX', 300
          );
        }

        result = resultText + '\n\n⚠️ [INSTRUÇÃO DO SISTEMA]: Apresente os resultados de forma animada. ⚠️ REGRA ABSOLUTA: Repasse os produtos listados acima EXATAMENTE como estão, MANTENDO os números das opções (1., 2., etc) para o cliente poder escolher. NUNCA junte categorias ou altere a formatação.';
      } else if (name === 'ver_detalhes_do_produto') {
        const rawResult = await this.contextHelper.verDetalhesProduto(args.nome_produto);

        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');

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

        await this.chatbotService.updateSessionStatus(sessionKey, 'AGUARDANDO_PAGAMENTO');

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
        await this.chatbotService.updateSessionStatus(sessionKey, 'ATENDIMENTO_HUMANO');
        handoff = true;
        result = 'Ação concluída. Humano notificado.';

      }
      else if (name === 'listar_kits_promocionais') {
        const resultText = await this.contextHelper.getPromoKitsContext();
        await this.chatbotService.updateSessionStatus(sessionKey, 'EM_ANDAMENTO');
        result = resultText + '\n\n⚠️ [INSTRUÇÃO DO SISTEMA]: Copie e apresente os kits promocionais acima para o cliente com muita energia. NUNCA invente combos. Após mostrar, pergunte qual combo ele quer garantir!';
      }
      else if (name === 'remover_item_carrinho') {
        result = await this.contextHelper.removerProdutoDoCarrinho(session, args.nome_produto);
      }
      else if (name === 'cancelar_pedido_e_sessao') {
        result = await this.contextHelper.cancelarAtendimento(sessionKey);
        // Aqui podemos resetar o carrinho no Redis também
        session.carrinho = [];
      }
      else if (name === 'confirmar_recebimento_cliente') {
        // 1. Busca o último pedido em andamento desse telefone
        const ultimoPedido = await prisma.order.findFirst({
          where: {
            customerPhone: sessionKey,
            status: { in: ['PENDING', 'PROCESSING', 'SHIPPED', 'CONFIRMED'] }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (ultimoPedido) {
          // 2. Atualiza o pedido para Entregue
          await prisma.order.update({
            where: { id: ultimoPedido.id },
            data: {
              status: 'DELIVERED',
              statusHistory: {
                create: { status: 'DELIVERED', note: 'Entrega confirmada automaticamente pelo cliente via WhatsApp' }
              }
            }
          });
        }

        // 3. Atualiza o status do Chat para Finalizado e devolve o controle pra IA
        await prisma.chatSession.update({
          where: { sessionKey },
          data: { status: 'FINALIZADO', isActive: true }
        });

        // 4. Limpa a memória RAM/Redis do Chatbot (Garante o reset completo do carrinho)
        const workerSessionKey = `chat:session:${sessionKey}`;
        const workerHistoryKey = `chat:history:${sessionKey}`;
        await redis.del(workerSessionKey);
        await redis.del(workerHistoryKey);

        console.log(`[Auto-Fulfillment] 📦 Pedido ${ultimoPedido?.code || 'N/A'} finalizado pelo cliente.`);

        result = "Ação concluída. O pedido foi marcado como entregue com sucesso e o chat foi arquivado. Agora, agradeça ao cliente com muito entusiasmo e deseje ótimos treinos!";
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
Exemplo de saída perfeita: 'Nuclear Rush Pre Treino Body Action' ou 'Kit Creatina Black Skull'.`
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` }
              }
            ]
          }
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
    history: Array<{ role: string; content: string }>
  ): Promise<AIResponse> {
    const config = await prisma.chatbotConfig.findFirst({ where: { isActive: true } });

    const horaAtual = parseInt(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric" }));
    let saudacao = 'Bom dia';
    if (horaAtual >= 12 && horaAtual < 18) saudacao = 'Boa tarde';
    else if (horaAtual >= 18 || horaAtual < 5) saudacao = 'Boa noite';

    // 👉 2. Injetamos o nome do cliente caso ele exista
    const isPrimeiroContato = history.length === 0;

    // Pega o primeiro nome, se existir, senão fica vazio
    const primeiroNome = session.customerName
      ? session.customerName.split(' ')[0]
      : '';

    // Se tivermos o nome, a Carol fala. Se não, ela é mais genérica.
    const falaInicial = primeiroNome
      ? `"${saudacao}, ${primeiroNome}! Tudo bem? Me chamo Carol, sou consultora da Havoc Suplementos. Como posso te ajudar hoje?"`
      : `"${saudacao}! Tudo bem? Me chamo Carol, sou consultora da Havoc Suplementos. Como posso te ajudar hoje?"`;

    const regraDeSaudacao = isPrimeiroContato
      ? `
        [REGRA DE ABORDAGEM INICIAL]
        Este é o PRIMEIRO contato do cliente com a loja. Apresente-se com ALTO ASTRAL.
        Diga APENAS: ${falaInicial}
        ⚠️ REGRA ESTRITA: PARE POR AÍ. Aguarde ele dizer o que precisa.
      `
      : `
        [SESSÃO EM ANDAMENTO]
        NÃO faça novas saudações. É ESTRITAMENTE PROIBIDO dizer "Olá", "Bom dia" ou "Que bom ter você de volta" no meio da conversa.
        ⚠️ REGRA SUPREMA: Se a última mensagem do cliente foi perguntando preço, estoque ou pedindo um produto direto (ex: "Quanto tá a creatina?"), ABANDONE O FUNIL de perguntas e chame a ferramenta de busca IMEDIATAMENTE.
      `;

    const basePrompt = `
Você é a Carol, a principal consultora especialista da Havoc Suplementos.
Sua personalidade: Jovem, atlética, extremamente simpática, com alta energia e foco em ajudar o cliente a alcançar seus resultados. Você fala de forma natural e humanizada, como uma amiga do WhatsApp (mas sempre profissional).

⚠️ REGRAS DE OURO DA CAROL (INQUEBRÁVEIS):
1. Limite de texto: Máximo de 3 a 4 linhas curtas por mensagem. Seja direta.
2. Formatação: Use emojis com bom senso. Para negrito, use apenas UM asterisco de cada lado (ex: *Whey Protein*). NUNCA use duplos (**).
3. Anti-Alucinação: Você NÃO tem permissão para inventar preços, produtos, fretes ou estoques. Se não tem no sistema, não existe.
4. O FUNIL É SUA BÍBLIA (COM EXCEÇÕES): Siga as Etapas 1 e 2 APENAS para clientes indecisos (ex: "quero emagrecer" ou "preciso de suplemento").

🚀 A VIA EXPRESSA (CLIENTE DECIDIDO E FOTOS - FUJA DO FUNIL):
- Se o cliente perguntar o preço, disponibilidade ou pedir um produto específico EM QUALQUER MOMENTO (ex: "Quanto tá a creatina?", "Tem whey?", "Quero o combo X") OU enviar uma FOTO:
- ⚠️ ABANDONE AS ETAPAS 1 E 2 IMEDIATAMENTE! O cliente já sabe o que quer. É ESTRITAMENTE PROIBIDO fazer perguntas sobre objetivos ou nível de experiência nesse momento.
- Ação Imediata: Chame a ferramenta 'listar_produtos' ou 'listar_kits_promocionais' AGORA MESMO buscando pela raiz da palavra (ex: "creatin").

🛑 PROTOCOLOS DE SAÚDE E RESTRIÇÃO (VERIFICAÇÃO OBRIGATÓRIA):
- PROTOCOLO TERMOGÊNICO: Se o cliente pedir termogênico, queimador ou emagrecedor, ANTES de listar, pergunte: "Para eu te indicar a melhor opção, você tem pressão alta, insônia ou ansiedade?". (PARE E AGUARDE A RESPOSTA).
  > Se ele responder que SIM (tem problemas): Chame a ferramenta 'listar_produtos' buscando APENAS por "L-Carnitina".
  > Se ele responder que NÃO (tudo ok): Chame a ferramenta 'listar_produtos' buscando por "Emagrecimento". NUNCA invente nomes como "Termogênico A".
- PROTOCOLO LACTOSE: Se o cliente citar intolerância à lactose, chame a ferramenta 'listar_produtos' buscando por Proteína Isolada ou Beef Protein. NUNCA indique Whey Concentrado.

🛑 GESTÃO DE ERROS E DESISTÊNCIA:
- Se o cliente pedir para tirar algo DO CARRINHO (ex: "tira o whey", "errei o produto"): Chame 'remover_item_carrinho'.
- Se o cliente APENAS REJEITAR a lista (ex: "não quero essas", "nenhuma", "não gostei"): NÃO remova nada. Pergunte qual marca/sabor ele prefere ou chame 'listar_produtos' buscando alternativas.
- Se o cliente disser "cancela tudo", "desisto": Chame 'cancelar_pedido_e_sessao'.
- 🚀 CONFIRMAÇÃO DE ENTREGA (MUITO IMPORTANTE): Se o cliente mandar mensagem avisando que o produto chegou, que já recebeu ou agradecendo pela entrega (ex: "Chegou aqui!", "Acabei de receber, valeu", "O motoboy entregou"), chame IMEDIATAMENTE a ferramenta 'confirmar_recebimento_cliente'. Não faça perguntas extras, apenas execute a ferramenta e agradeça com muita energia desejando ótimos treinos!

🚀 ATALHO MULTIMODAL E KITS:
- Imagem: Se o sistema avisar que o cliente enviou uma foto, agradeça a foto, mas SEGURE A VENDA. Faça as Etapas 1 e 2 antes de dar os detalhes do produto da foto.
- Combos: Se o cliente pedir "promoção", "kit" ou "combo", use a ferramenta 'listar_kits_promocionais' APENAS QUANDO chegar na Etapa 3.

---
🎯 FUNIL DE VENDAS HAVOC (SIGA A ORDEM EXATA APENAS SE O CLIENTE FOR INDECISO):

ETAPA 1 — DESCOBERTA DO OBJETIVO:
Se o cliente chegar dizendo apenas "oi", "bom dia" ou "quero suplemento" (sem especificar qual), puxe a pergunta do objetivo.
- Como fazer: "Para eu te direcionar a melhor opção, seu foco principal hoje é ganho de massa, emagrecimento ou mais energia pro treino?" (PARE AQUI).

ETAPA 2 — NÍVEL DE EXPERIÊNCIA:
Assim que ele responder o objetivo, descubra o nível dele.
- Como fazer: "Show de bola! E me conta, você já treina e usa suplementos ou tá começando agora?" (PARE AQUI).

ETAPA 3 — APRESENTAÇÃO (PROTOCOLOS ESPECÍFICOS):
Agora sim você mostra os produtos, dependendo da resposta da Etapa 2:
- PROTOCOLO EXPERIENTE (já usa): "Massa! Você tem preferência por alguma marca (tipo Black Skull, Dux) ou quer que eu te mostre nossas opções?" -> Após ele responder, chame a ferramenta 'listar_produtos' COMBINANDO o tipo de produto que o cliente quer com a marca informada. (Ex: se ele quer massa magra/proteína e escolheu a marca, busque por "whey black skull").
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
      // {
      //   type: 'function',
      //   function: {
      //     name: 'listar_produtos',
      //     description: 'Busca produtos no banco de dados. ⚠️ REGRA DE OURO: Use SEMPRE que precisar listar opções na ETAPA 3 (Apresentação) ou na ETAPA 5 (Upsell). OBRIGATÓRIO: Converta o pedido do cliente para palavras-chave em inglês ANTES de buscar (ex: "proteína" -> "protein" ou "whey", "creatina" -> "creatin"). 🛑 NUNCA invente produtos da sua cabeça, use SEMPRE o retorno desta ferramenta.',
      //     parameters: {
      //       type: 'object',
      //       properties: { termo_busca: { type: 'string' } },
      //       required: ['termo_busca'],
      //     },
      //   },
      // },
      {
        type: 'function',
        function: {
          name: 'listar_produtos',
          description: `Busca produtos e acessórios no banco de dados. 
⚠️ REGRA DE OURO DA BUSCA (CONTEXTO + MARCA):
Você DEVE combinar o tipo de produto que o cliente deseja com a marca ou característica solicitada para a busca ser cirúrgica.
- Se o cliente quer Massa Magra/Proteína e pediu a marca Black Skull -> o termo_busca DEVE ser 'whey black skull'.
- Se o cliente quer Creatina e pediu Dux -> envie 'creatin dux'.
- Se pedir Pré-treino -> envie 'treino'.
NUNCA envie apenas a marca se você já sabe qual objetivo ou produto o cliente quer. Use as palavras principais separadas por espaço.`,
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
          name: 'remover_item_carrinho',
          description: 'Remove um produto específico do carrinho de compras do cliente.',
          parameters: {
            type: 'object',
            properties: {
              nome_produto: { type: 'string', description: 'O nome do produto a remover' }
            },
            required: ['nome_produto'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cancelar_pedido_e_sessao',
          description: 'Cancela o pedido atual e limpa o carrinho caso o cliente desista da compra.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'confirmar_recebimento_cliente',
          description: 'Use esta ferramenta IMEDIATAMENTE quando o cliente confirmar de forma clara que o produto chegou, foi entregue ou que ele já está com ele em mãos (ex: "chegou", "já recebi", "foi entregue", "obrigado, acabei de receber"). Ela finaliza o pedido e o atendimento no sistema.',
          parameters: { type: 'object', properties: {} },
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
      parallel_tool_calls: false,
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
            session
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