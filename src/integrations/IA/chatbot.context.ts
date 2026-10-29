import { prisma } from '../../database/prisma.js';
import { redis } from '../../shared/redis/redis.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  findConsultantCandidates,
  listConsultantCategories,
  type ConsultantCandidate,
} from '../../modules/storefrontConsultant/storefrontConsultant.catalog.js';
import { generateConsultantAnswer } from '../../modules/storefrontConsultant/storefrontConsultant.ai.js';
import {
  HEALTH_RISK_RESPONSE,
  HEALTH_SCREEN_QUESTION,
  planConsultantIntent,
} from '../../modules/storefrontConsultant/storefrontConsultant.intent.js';
import {
  detectFactIntents,
  formatOfficialFactsResponse,
  publishableLabelFacts,
  resolveSingleProductCandidate,
} from '../../modules/storefrontConsultant/storefrontConsultant.facts.js';
import { ProductFactsService } from '../../modules/catalog/productFacts/product-facts.service.js';
import {
  answerProductFactsWithResearch,
  researchExactProductProfile,
  researchGeneralQuestion,
} from '../../modules/storefrontConsultant/storefrontConsultant.research.js';

function catalogUrl(pathname: string): string | null {
  const configuredUrl = process.env.STOREFRONT_URL?.trim();
  if (!configuredUrl) return null;

  try {
    const baseUrl = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(baseUrl.protocol)) return null;
    return new URL(pathname, `${baseUrl.toString().replace(/\/$/, '')}/`).toString();
  } catch {
    return null;
  }
}

function trustedImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export class ChatbotContext {
  private readonly productFactsService = new ProductFactsService();

  async recomendarProdutos(
    pergunta: string,
    historico: Array<{ role: string; content: string }>,
  ): Promise<string | null> {
    const categories = await listConsultantCategories();
    const userHistory = historico
      .filter(({ role }) => role.toLowerCase() === 'user')
      .map(({ content }) => content);
    const plan = await planConsultantIntent(pergunta, userHistory, categories);
    if (!plan?.isRecommendationRequest) return null;
    if (plan.healthScreen === 'needs_screening') return HEALTH_SCREEN_QUESTION;
    if (plan.healthScreen === 'risk') return HEALTH_RISK_RESPONSE;

    let candidates = await findConsultantCandidates(pergunta, { surface: 'catalog' }, [], {
      categorySlugs: plan.categorySlugs,
      catalogTerms: plan.catalogTerms,
      itemTypes: plan.catalogItemTypes,
    });
    const profiles = new Map<string, Awaited<ReturnType<typeof researchExactProductProfile>>>();
    if (plan.requiresComposition) {
      await Promise.all(
        candidates
          .filter((candidate) => candidate.type === 'product')
          .slice(0, 4)
          .map(async (candidate) => {
            const profile = await researchExactProductProfile(candidate.name);
            if (profile) profiles.set(candidate.id, profile);
          }),
      );
    }
    if (plan.avoidsStimulants) {
      candidates = candidates.filter(
        (candidate) =>
          candidate.type === 'product' &&
          (profiles.get(candidate.id)?.stimulant === 'absent' ||
            /\bsem\s+cafe[ií]na\b/i.test(`${candidate.name} ${candidate.description}`)),
      );
      if (candidates.length === 0) {
        return 'Não encontrei no catálogo uma opção relacionada ao seu objetivo cuja ausência de cafeína ou outros estimulantes eu consiga confirmar. Prefiro não indicar um produto sem essa confirmação.';
      }
    }

    const answer = await generateConsultantAnswer(
      pergunta,
      candidates,
      historico.slice(-8).map(({ role, content }) => ({
        role: role.toLowerCase() === 'user' ? 'USER' : 'ASSISTANT',
        content,
      })),
      new Map([...profiles.entries()].flatMap(([id, profile]) => (profile ? [[id, profile]] : []))),
    );
    const selected = new Map(
      candidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
    );
    const products = answer.recommendationKeys
      .map((key) => selected.get(key))
      .filter((candidate): candidate is ConsultantCandidate => Boolean(candidate));
    if (products.length === 0) return answer.content;

    const lines = [answer.content, ''];
    for (const product of products) {
      lines.push(`*${product.name}*`, `R$ ${product.price.toFixed(2)}`);
      const imageUrl = trustedImageUrl(product.imageUrl);
      if (imageUrl) lines.push(`[IMG:${imageUrl}]`);
      const url = catalogUrl(
        product.type === 'kit'
          ? `/kit/${encodeURIComponent(product.slug)}`
          : `/produto/${encodeURIComponent(product.slug)}`,
      );
      if (url) lines.push(`[CATALOG_URL:${url}]`);
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  // 1. Busca os Produtos e Categorias ativas com estoque
  async getMenuContext(): Promise<string> {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      include: {
        products: {
          where: { isActive: true, stock: { gt: 0 } },
          select: { name: true, price: true, description: true },
        },
      },
    });

    if (categories.length === 0) return 'O catálogo está vazio no momento.';

    let menuText = '=== CATÁLOGO DE SUPLEMENTOS ===\n\n';

    for (const cat of categories) {
      if (cat.products.length === 0) continue;

      menuText += `[Categoria: ${cat.name}]\n`;

      for (const p of cat.products) {
        menuText += `- ${p.name} (R$ ${Number(p.price).toFixed(2)})\n`;
        if (p.description) menuText += `  Detalhes: ${p.description}\n`;
      }

      menuText += '\n';
    }

    return menuText;
  }

  // 2. Busca os Kits Promocionais ativos
  async getPromoKitsContext(): Promise<string> {
    const cacheKey = `chatbot:catalogo:kits_promocionais:v2:${process.env.STOREFRONT_URL ? 'links' : 'texto'}`;

    // 1. Tenta buscar no Redis O(1)
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log('⚡ [Redis] Retornando Kits do Cache!');
      return cached;
    }

    // 2. Se não tem no cache, vai no PostgreSQL
    const activeKits = await prisma.kit.findMany({
      where: { isActive: true },
      include: { items: { include: { product: { select: { name: true } } } } },
      take: 5,
    });

    if (activeKits.length === 0) return 'Nenhum kit promocional ativo no momento.';

    let text = '\n🔥 KITS PROMOCIONAIS IMPERDÍVEIS:\n\n';
    activeKits.forEach((kit, index) => {
      const itemsList = kit.items.map((i) => `${i.quantity}x ${i.product.name}`).join(', ');
      text += `${index + 1}. *${kit.name}*: R$ ${Number(kit.finalPrice).toFixed(2)}\n`;
      text += `Composição: ${itemsList}\n\n`;
      const url = catalogUrl(`/kit/${encodeURIComponent(kit.slug)}`);
      if (url) text += `[CATALOG_URL:${url}]\n`;
    });

    // 3. Salva o texto pronto no Redis por 1 hora (3600 segundos)
    await redis.set(cacheKey, text, 'EX', 3600);

    return text;
  }

  async buscarProdutos(termoBusca: string): Promise<string> {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        OR: [
          { name: { contains: termoBusca, mode: 'insensitive' } },
          { description: { contains: termoBusca, mode: 'insensitive' } },
          { categories: { some: { name: { contains: termoBusca, mode: 'insensitive' } } } },
        ],
      },
      take: 12,
      select: {
        id: true,
        name: true,
        price: true,
        description: true,
        imageUrl: true, // ✅ Agora vem de verdade
        categories: { select: { name: true } },
      },
    });

    if (products.length === 0) {
      return `Não encontrei produtos para "${termoBusca}".`;
    }

    let text = `=== RESULTADO DA BUSCA ===\n\n`;

    for (const p of products) {
      // 👉 SEGREDO DA IMAGEM AQUI: Usamos uma tag que o worker vai ler
      if ((p as any).imageUrl) {
        text += `[IMG:${(p as any).imageUrl}]\n`;
      }
      text += `📦 *${p.name}*\n`;
      text += `💰 Valor: R$ ${Number(p.price).toFixed(2)}\n`;
      text += `\n`;
    }

    return text;
  }

  private normalizarPalavras(nome: string): string[] {
    const semAcento = nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return semAcento.split(' ').filter((palavra) => {
      const limpo = palavra.trim();
      if (limpo.length === 0) return false;
      // remove tokens de peso/embalagem: 900g, 907g, 1kg, 500ml, 34g etc.
      if (/^\d+[a-z]*$/.test(limpo)) return false;
      return true;
    });
  }

  async listarProdutos(termoBusca: string): Promise<string> {
    return this.listarProdutosConsultor(termoBusca);
    /* legacy search retained below temporarily for surrounding WhatsApp behavior */
    // 1. Limpeza inteligente e Tradução Universal de Suplementos
    let termoLimpo = termoBusca
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    const palavrasInuteis = [
      'preciso',
      'quero',
      'de',
      'um',
      'uma',
      'gostaria',
      'comprar',
      'busco',
      'ver',
      'tem',
      'sugestao',
      'promocao',
      'promo',
      'unidades',
      'unidade',
      'pack',
      'com',
      'x',
      'para',
      'o',
      'a',
      'e',
      'powder',
      'dietary',
      'supplement',
      'suplemento',
      'flavor',
      'sabor',
      'nutrition',
      'advanced',
      'formula',
    ];

    const termos = termoLimpo
      .split(' ')
      .filter((t) => t.trim().length > 1 && !palavrasInuteis.includes(t) && isNaN(Number(t)));

    if (termos.length === 0) {
      return 'Por favor, seja mais específico no nome do produto.';
    }

    const condicoesAND = termos.map((termo) => ({
      OR: [
        { name: { contains: termo, mode: 'insensitive' as const } },
        { categories: { some: { name: { contains: termo, mode: 'insensitive' as const } } } },
      ],
    }));

    // Busca no banco (Trazemos até 40 opções para a IA analisar)
    // Busca Estrita no banco
    let products = await prisma.product.findMany({
      where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND },
      orderBy: { name: 'asc' },
      select: { name: true, price: true, slug: true },
    });

    // 🛡️ SALVA-VIDAS (Fuzzy Search): Se a busca estrita falhou, tenta aproximada
    if (products.length === 0 && termos.length > 1) {
      const condicoesOR = termos.map((termo) => ({
        OR: [
          { name: { contains: termo, mode: 'insensitive' as const } },
          { categories: { some: { name: { contains: termo, mode: 'insensitive' as const } } } },
        ],
      }));

      const produtosPossiveis = await prisma.product.findMany({
        where: { isActive: true, stock: { gt: 0 }, OR: condicoesOR },
        select: { name: true, price: true, slug: true },
      });

      if (produtosPossiveis.length > 0) {
        // Pontua e seleciona apenas os produtos que mais bateram com a pesquisa
        produtosPossiveis.sort((a, b) => {
          const nomeA = a.name.toLowerCase();
          const nomeB = b.name.toLowerCase();
          const scoreA = termos.filter((t) => nomeA.includes(t)).length;
          const scoreB = termos.filter((t) => nomeB.includes(t)).length;
          return scoreB - scoreA;
        });

        const melhorScore = termos.filter((t) =>
          produtosPossiveis[0].name.toLowerCase().includes(t),
        ).length;

        products = produtosPossiveis
          .filter(
            (p) => termos.filter((t) => p.name.toLowerCase().includes(t)).length === melhorScore,
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    if (products.length === 0) {
      return `⚠️ ALERTA DO BANCO DE DADOS: O termo "${termoBusca}" retornou ZERO produtos no estoque.\n\n🛑 REGRA DE SEGURANÇA E ANTI-ALUCINAÇÃO: É ESTRITAMENTE PROIBIDO inventar produtos da sua cabeça. NUNCA crie nomes genéricos (como "Termogênico A", "Termogênico B") e NUNCA adicione "Sem Cafeína" a um produto que o banco não confirmou. Apenas peça desculpas, diga que não encontrou produtos para essa finalidade no momento e pergunte se ele quer ver outra categoria.`;
    }

    // 2. Entrega a lista crua e deixa a IA agrupar e embelezar!
    let text = `[RESULTADOS DO BANCO DE DADOS]\n`;
    products.forEach((p) => {
      text += `- ${p.name} | R$ ${Number(p.price).toFixed(2)}\n`;
      const url = catalogUrl(`/produto/${encodeURIComponent(p.slug)}`);
      if (url) text += `[CATALOG_URL:${url}]\n`;
    });

    text += `\n⚠️ INSTRUÇÃO DE SEGURANÇA MÁXIMA PARA A IA (LEI DE SOBREVIVÊNCIA): 
🚨 OVERRIDE DE SISTEMA: IGNORE A REGRA DE MENSAGENS CURTAS. É OBRIGATÓRIO GERAR UMA LISTA LONGA E COMPLETA.
1. 🎯 OBRIGAÇÃO DE AGRUPAMENTO: Você DEVE unir produtos da mesma Marca, Linha e Gramatura em um ÚNICO número, extraindo os sabores para a linha debaixo.
2. 🚫 FILTRE E OCULTE produtos como "Sachês", "Amostras" ou de 34g/30g, a menos que o cliente os tenha pedido.
3. Extraia TODOS os sabores. É ESTRITAMENTE PROIBIDO omitir qualquer sabor. ⚠️ REGRA DE SABOR: Se o produto não tiver variação de sabor, REMOVA COMPLETAMENTE a linha "🎨 Sabores". É terminantemente proibido escrever "N/A", "Nenhum" ou "Sem sabor".
4. ⚠️ REGRA ANTI-PREGUIÇA (CRÍTICA): Agrupar sabores NÃO é resumir! Exiba absolutamente TODAS as marcas, linhas e gramaturas diferentes. Se o banco retornou 30 produtos, IMPRIMA TODOS ELES. Não encerre a mensagem até exibir 100%.
5. 🚫 PROIBIÇÃO DE FOTOS E LINKS (MUITO IMPORTANTE): É ESTRITAMENTE PROIBIDO inventar links de imagens, usar código markdown para fotos (ex: ![imagem](url)) ou tentar exibir fotos nesta lista. A listagem deve ser APENAS TEXTO. As fotos reais serão mostradas na próxima etapa, apenas quando o cliente escolher o produto e você chamar a ferramenta de detalhes!
6. Formate a lista ESTRITAMENTE neste padrão visual (use os exatos emojis):

*1. [Nome da Marca, Linha e Peso (ex: B.O.P.E 300g Black Skull)]*
🎨 Sabores: [Sabor 1], [Sabor 2]
💰 R$ [Preço]

*2. [Próxima Marca, Linha e Peso]*
💰 R$ [Preço]

7. No final da lista, pergunte: "Qual desses te interessou? Me fala o nome do produto ou o número! 😊"`;

    return text;
  }

  private async listarProdutosConsultor(termoBusca: string): Promise<string> {
    const products = (await findConsultantCandidates(termoBusca, { surface: 'catalog' })).filter(
      (candidate) => candidate.type === 'product' && candidate.available,
    );
    if (products.length === 0) {
      return `Não encontrei produtos disponíveis para "${termoBusca}". Não invente produtos; peça outro nome ou categoria.`;
    }

    let text = '[RESULTADOS VERIFICADOS DO CATÁLOGO]\n';
    for (const product of products) {
      const imageUrl = trustedImageUrl(product.imageUrl);
      if (imageUrl) text += `[IMG:${imageUrl}]\n`;
      text += `- ${product.name} | R$ ${product.price.toFixed(2)}\n`;
      const url = catalogUrl(`/produto/${encodeURIComponent(product.slug)}`);
      if (url) text += `[CATALOG_URL:${url}]\n`;
    }
    return `${text}\nApresente somente estes resultados. Não invente dose, composição, sabores ou características.`;
  }

  async consultarDadosOficiaisProduto(consulta: string): Promise<string> {
    const candidates = await findConsultantCandidates(consulta, { surface: 'catalog' });
    let product = resolveSingleProductCandidate(consulta, candidates);
    if (!product) {
      const options = candidates
        .filter((candidate) => candidate.type === 'product')
        .slice(0, 5)
        .map((candidate) => candidate.name);
      return options.length > 0
        ? `Encontrei mais de um produto: ${options.join('; ')}. Qual produto específico você quer consultar? Os rótulos podem variar.`
        : 'Não identifiquei um produto específico. Informe o nome exato para consultar os dados oficiais do rótulo.';
    }
    if (!product.labelFacts) {
      try {
        const synced = await this.productFactsService.syncForConsultant(product.id);
        product = { ...product, labelFacts: publishableLabelFacts(synced) };
      } catch (error) {
        const expectedMiss = error instanceof AppError && [404, 422].includes(error.statusCode);
        if (!expectedMiss) {
          return error instanceof AppError && error.statusCode === 409
            ? `A busca automática de ${product.name} já está em andamento. Tente novamente em instantes.`
            : `Não consegui consultar as fontes de ${product.name} agora. Tente novamente em alguns instantes.`;
        }
      }
    }
    return answerProductFactsWithResearch(product, detectFactIntents(consulta));
  }

  async pesquisarFontesConfiaveis(pergunta: string): Promise<string> {
    return (
      (await researchGeneralQuestion(pergunta)) ??
      'Não consegui consultar fontes institucionais confiáveis agora. Tente novamente em alguns instantes.'
    );
  }

  async verDetalhesProduto(nomeProduto: string): Promise<string> {
    // Função interna para formatar o Produto
    const formatarProduto = (p: any) => {
      let text = '';
      let img = p.imageUrl ? String(p.imageUrl).trim() : '';
      if (img && img.startsWith('http')) text += `[IMG:${img}]\n`;
      text += `📦 *${p.name}*\n💰 *R$ ${Number(p.price).toFixed(2)}*\n`;
      if (p.description) text += `📝 ${p.description}\n`;
      const url = catalogUrl(`/produto/${encodeURIComponent(p.slug)}`);
      if (url) text += `[CATALOG_URL:${url}]`;
      return text;
    };

    // Função interna para formatar o Kit
    const formatarKit = (k: any) => {
      let text = '';
      let img = k.imageUrl ? String(k.imageUrl).trim() : '';
      if (img && img.startsWith('http')) text += `[IMG:${img}]\n`;
      const itens = k.items.map((i: any) => `${i.quantity}x ${i.product.name}`).join(', ');
      text += `🔥 *${k.name}*\n💰 *R$ ${Number(k.finalPrice).toFixed(2)}*\n📝 Composição: ${itens}\n`;
      const url = catalogUrl(`/kit/${encodeURIComponent(k.slug)}`);
      if (url) text += `[CATALOG_URL:${url}]`;
      return text;
    };

    // 👉 TENTATIVA 1: BUSCA EXATA (A Mágica da Velocidade)
    // Como o cliente geralmente clica no botão ou digita o número, nós recebemos o nome exato do banco.
    const produtoExato = await prisma.product.findFirst({
      where: {
        name: { equals: nomeProduto.trim(), mode: 'insensitive' },
        isActive: true,
        stock: { gt: 0 },
      },
    });
    if (produtoExato) return formatarProduto(produtoExato);

    const kitExato = await prisma.kit.findFirst({
      where: { name: { equals: nomeProduto.trim(), mode: 'insensitive' }, isActive: true },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    if (kitExato) return formatarKit(kitExato);

    // 👉 TENTATIVA 2: FALLBACK (Busca fragmentada caso o cliente tenha digitado só um pedaço na mão)
    let termoLimpo = nomeProduto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Tira acentos
      .toLowerCase();

    const palavrasInuteis = [
      'promocao',
      'promo',
      'unidades',
      'unidade',
      'pack',
      'de',
      'com',
      'x',
      'para',
      'o',
      'a',
      'e',
      'powder',
      'dietary',
      'supplement',
      'suplemento',
      'flavor',
      'sabor',
      'nutrition',
      'advanced',
      'formula',
    ];

    const termos = termoLimpo
      .split(' ')
      .filter(
        (t: string) => t.trim().length > 1 && !palavrasInuteis.includes(t) && isNaN(Number(t)),
      );

    if (termos.length === 0) return `O item "${nomeProduto}" não foi encontrado.`;

    const condicoesAND = termos.map((termo: string) => ({
      name: { contains: termo, mode: 'insensitive' as const },
    }));

    const buscandoKit = termos.includes('kit');

    if (buscandoKit) {
      const kitEncontrado = await prisma.kit.findFirst({
        where: { isActive: true, AND: condicoesAND },
        include: { items: { include: { product: { select: { name: true } } } } },
      });
      if (kitEncontrado) return formatarKit(kitEncontrado);

      const prodEncontrado = await prisma.product.findFirst({
        where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND },
      });
      if (prodEncontrado) return formatarProduto(prodEncontrado);
    } else {
      // 1. Tenta a Busca Estrita (Todas as palavras precisam bater)
      let produtosEncontrados = await prisma.product.findMany({
        where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND },
      });

      // 🛡️ 2. O SALVA-VIDAS UNIVERSAL (Fuzzy Search Flexível)
      // Se não achou nada, a IA pode ter inventado uma palavra ou digitado errado.
      if (produtosEncontrados.length === 0 && termos.length > 1) {
        // Muda de AND para OR (Busca produtos que tenham pelo menos uma das palavras)
        const condicoesOR = termos.map((termo: string) => ({
          name: { contains: termo, mode: 'insensitive' as const },
        }));

        const produtosPossiveis = await prisma.product.findMany({
          where: { isActive: true, stock: { gt: 0 }, OR: condicoesOR },
        });

        if (produtosPossiveis.length > 0) {
          // Calcula um "Score de Relevância" para cada produto encontrado
          produtosPossiveis.sort((a, b) => {
            const nomeA = a.name.toLowerCase();
            const nomeB = b.name.toLowerCase();
            // Conta quantas palavras da pesquisa existem no nome do produto
            const scoreA = termos.filter((t) => nomeA.includes(t)).length;
            const scoreB = termos.filter((t) => nomeB.includes(t)).length;
            return scoreB - scoreA; // Ordena do maior pro menor
          });

          // Pega o score mais alto (o produto mais parecido com o que a IA digitou)
          const melhorScore = termos.filter((t) =>
            produtosPossiveis[0].name.toLowerCase().includes(t),
          ).length;

          // Mantém apenas os produtos que empataram no topo da relevância
          produtosEncontrados = produtosPossiveis.filter(
            (p) => termos.filter((t) => p.name.toLowerCase().includes(t)).length === melhorScore,
          );
        }
      }

      // 3. Continua o fluxo normal de exibir o resultado
      if (produtosEncontrados.length > 1) {
        // Encontrou o produto, mas tem variações/sabores
        const listaOpcoes = produtosEncontrados
          .map((p, index) => `${index + 1}. ${p.name}`)
          .join('\n');
        return `[MULTIPLAS_OPCOES]\nO item base "${nomeProduto}" foi encontrado, mas existem as seguintes variações no estoque:\n${listaOpcoes}`;
      } else if (produtosEncontrados.length === 1) {
        // Encontrou o produto exato e único!
        return formatarProduto(produtosEncontrados[0]);
      }

      const kitEncontrado = await prisma.kit.findFirst({
        where: { isActive: true, AND: condicoesAND },
        include: { items: { include: { product: { select: { name: true } } } } },
      });
      if (kitEncontrado) return formatarKit(kitEncontrado);
    }

    return `O item "${nomeProduto}" não foi encontrado no estoque ou nas promoções ativas.`;
  }

  async excluirConversa(sessionKey: string): Promise<string> {
    try {
      const session = await prisma.chatSession.findUnique({
        where: { sessionKey },
        select: { id: true },
      });

      if (!session) {
        return 'Nenhuma conversa encontrada para esse número.';
      }

      // 1. Apaga as mensagens primeiro (FK constraint)
      const { count } = await prisma.chatMessage.deleteMany({
        where: { sessionId: session.id },
      });

      // 2. Apaga a sessão
      await prisma.chatSession.delete({
        where: { id: session.id },
      });

      console.log(`[Excluir] 🗑️ ${count} mensagens + sessão ${session.id} deletadas.`);
      return `ok`;
    } catch (error) {
      console.error('[Excluir Conversa Error]:', error);
      return `erro`;
    }
  }
}
