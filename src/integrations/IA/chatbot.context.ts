import { prisma } from '../../database/prisma.js';
import { PaymentsService } from '../../modules/payments/payments.service.js';
import { redis } from '../../shared/redis/redis.js';
import { io } from '../../shared/socket/socket.js';

export class ChatbotContext {
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
    const cacheKey = 'chatbot:catalogo:kits_promocionais';

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
    });

    // 3. Salva o texto pronto no Redis por 1 hora (3600 segundos)
    await redis.set(cacheKey, text, 'EX', 3600);

    return text;
  }

  // 3. Busca pedidos em andamento pelo telefone do cliente
  async getOrderStatus(phone: string): Promise<string> {
    const orders = await prisma.order.findMany({
      where: {
        client: { phone },
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
      select: { id: true, status: true, total: true },
    });

    if (orders.length === 0) {
      return 'Você não possui pedidos em andamento no momento.';
    }

    return orders
      .map(
        (order) =>
          `Pedido #${order.id.split('-')[0].toUpperCase()} | Status: ${order.status} | Total: R$ ${Number(order.total).toFixed(2)}`,
      )
      .join('\n');
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

  async gerarCheckout(sessionKey: string, dadosCheckout: any): Promise<string> {
    try {
      // 1. Busca o nome do cliente que foi capturado na sessão do Chatbot
      const chatSession = await prisma.chatSession.findUnique({
        where: { sessionKey },
      });

      const customerName = chatSession?.customerName || 'Cliente WhatsApp';
      const customerPhone = sessionKey; // O número do WhatsApp é a própria sessionKey

      let subtotal = 0;
      const orderItemsData = [];
      const itensNaoEncontrados = [];

      // 2. Itera sobre os produtos/kits que a IA enviou
      for (const item of dadosCheckout.produtos) {
        // 👉 A BLINDAGEM: Tenta pegar 'quantidade', se vier 'quantity' ele pega também, se vier vazio, assume 1.
        const qtd = Number(item.quantidade || item.quantity || 1);

        // --- TENTATIVA 1: É UM PRODUTO ISOLADO? ---
        const produtoBanco = await prisma.product.findFirst({
          where: { name: { contains: item.nome_produto, mode: 'insensitive' } },
        });

        if (produtoBanco) {
          const itemTotal = Number(produtoBanco.price) * qtd;
          subtotal += itemTotal;

          orderItemsData.push({
            productId: produtoBanco.id,
            quantity: qtd, // Usa a variável blindada
            unitPrice: produtoBanco.price,
            totalPrice: itemTotal,
          });
          continue;
        }

        // --- TENTATIVA 2: É UM KIT PROMOCIONAL? ---
        const kitBanco = await prisma.kit.findFirst({
          where: { name: { contains: item.nome_produto, mode: 'insensitive' } },
          include: { items: true },
        });

        if (kitBanco) {
          const itemTotal = Number(kitBanco.finalPrice) * qtd;
          subtotal += itemTotal;

          for (const kitItem of kitBanco.items) {
            orderItemsData.push({
              productId: kitItem.productId,
              quantity: kitItem.quantity * qtd, // Usa a variável blindada
              unitPrice: 0,
              totalPrice: 0,
            });
          }
          continue;
        }

        itensNaoEncontrados.push(item.nome_produto);
      }

      if (itensNaoEncontrados.length > 0) {
        return `Tivemos um problema para validar os seguintes itens no estoque: ${itensNaoEncontrados.join(', ')}. Peça desculpas e peça para o cliente confirmar os nomes exatos.`;
      }

      // 3. Calcula Frete Fixo e define o endereço completo
      const deliveryAddress =
        dadosCheckout.metodo_entrega === 'ENTREGA' ? dadosCheckout.endereco_ou_cep : null;
      let frete = 0.0;

      if (deliveryAddress) {
        const inputLimpo = deliveryAddress.toLowerCase();
        let rule = null;

        // Tenta achar por Bairro (Region)
        const regras = await prisma.shippingRule.findMany({
          where: { isActive: true, region: { not: null } },
        });
        rule = regras.find((r) => inputLimpo.includes(String(r.region).toLowerCase())) || null;

        // Tenta Taxa Padrão (Sem Region)
        if (!rule) {
          rule = await prisma.shippingRule.findFirst({
            where: { isActive: true, region: null },
            orderBy: { price: 'asc' },
          });
        }

        frete = rule ? Number(rule.price) : 15.0; // Usa 15 como segurança se o DB estiver vazio
      }

      const total = subtotal + frete;

      // 4. CRIA O PEDIDO NO BANCO COM OS NOVOS CAMPOS DO CLIENTE E ENDEREÇO
      const novoPedido = await prisma.order.create({
        data: {
          code: `HAV-${Math.floor(10000 + Math.random() * 90000)}`,
          status: 'PENDING',
          customerName,
          customerPhone,
          deliveryAddress,
          subtotal,
          shippingCost: frete,
          total,
          notes: dadosCheckout.notes || null,
          items: {
            create: orderItemsData,
          },
          statusHistory: {
            create: [{ status: 'PENDING', note: 'Pedido gerado via WhatsApp (IA)' }],
          },
        },
      });

      await prisma.chatSession.update({
        where: { sessionKey },
        data: { status: 'AGUARDANDO_PAGAMENTO' },
      });

      // 🔥 5. INTEGRAÇÃO MERCADO PAGO / SICREDI: Desativada temporariamente para testes 🔥
      let pixCopiaECola = '';
      let linkPagamento = '';

      const paymentsService = new PaymentsService(); // Instanciando o motor real

      if (dadosCheckout.metodo_pagamento === 'PIX') {
        const pixData = await paymentsService.generatePix(
          novoPedido.id,
          'cliente@havoc.com.br',
          customerName,
        );
        pixCopiaECola = pixData.pixCode || '';
      } else if (dadosCheckout.metodo_pagamento === 'CARTAO') {
        const linkData = await paymentsService.generateLink(novoPedido.id);
        linkPagamento = linkData.paymentLink || '';
      }

      // 6. DEVOLVE O TEXTO PRONTO PARA A IA MANDAR PRO CLIENTE
      let textoResposta = `✅ *Pedido #${novoPedido.code} Gerado com Sucesso!*\n\n`;
      textoResposta += `*Resumo da Compra:*\n`;

      dadosCheckout.produtos.forEach((p: any) => {
        // Protege também na hora de imprimir no WhatsApp
        const printQtd = p.quantidade || p.quantity || 1;
        textoResposta += `- ${printQtd}x ${p.nome_produto}\n`;
      });

      textoResposta += `\nSubtotal: R$ ${subtotal.toFixed(2)}`;
      textoResposta += `\nFrete: R$ ${frete.toFixed(2)}`;
      textoResposta += `\n*TOTAL: R$ ${total.toFixed(2)}*\n\n`;

      // 7. INJETA O QR CODE E AS INSTRUÇÕES DE PAGAMENTO NO FINAL
      if (dadosCheckout.metodo_pagamento === 'PIX') {
        textoResposta += `👇 *PAGAMENTO VIA PIX* 👇\n`;
        textoResposta += `Utilize a chave copia-e-cola abaixo para finalizar:\n\n`;
        textoResposta += `[PIX:${pixCopiaECola}]\n\n`;
        textoResposta += `Assim que o pagamento for aprovado, nosso sistema confirma tudo automaticamente por aqui! 🚀`;
      } else if (dadosCheckout.metodo_pagamento === 'CARTAO') {
        textoResposta += `💳 *PAGAMENTO NO CARTÃO* 💳\n`;
        textoResposta += `Acesse seu link seguro para finalizar a compra:\n\n`;
        textoResposta += `${linkPagamento}\n\n`;
        textoResposta += `Após o pagamento, seu pedido será confirmado automaticamente! 🚀`;
      } else {
        textoResposta += `💵 Pagamento em dinheiro selecionado. Deixe o valor separado para entregar ao motoboy. Precisa de troco?`;
      }
      // 🔥 8. IMPRESSÃO DA VIA: Controle Inteligente 🔥
      try {
        if (io) {
          const cupom = {
            codigo: novoPedido.code,
            cliente: customerName,
            telefone: customerPhone,
            endereco: deliveryAddress || '>>> RETIRADA BALCÃO <<<',
            itens: dadosCheckout.produtos.map(
              (p: any) => `${p.quantidade || p.quantity || 1}x ${p.nome_produto}`,
            ),
            total: total,
            data: new Date().toLocaleString('pt-BR'),
          };

          if (dadosCheckout.metodo_pagamento === 'DINHEIRO') {
            io.emit('imprimir_cupom', cupom);
            console.log(
              `[Impressão Imediata] 🖨️ Pagamento Físico selecionado. Pedido ${novoPedido.code}`,
            );
          } else {
            console.log(
              `[Aguardando Pagamento] ⏳ Pedido ${novoPedido.code} retido. Impressão aguardando o Webhook do Mercado Pago.`,
            );
          }
        }
      } catch (printError) {
        console.error('[Erro na emissão do cupom]:', printError);
      }

      // 9. Retorna o texto para a Carol
      return textoResposta;
    } catch (error) {
      console.error('[Erro ao gerar checkout]:', error);
      return 'Ocorreu um erro interno ao gerar o número do pedido. Avise ao cliente que você vai chamar um humano para finalizar a venda.';
    }
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
    const products = await prisma.product.findMany({
      where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND },
      orderBy: { name: 'asc' }, // 👉 Ajuda a IA a ler os itens já agrupados!
      select: { name: true, price: true },
    });

    if (products.length === 0) {
      return `Não encontrei produtos exatamente para "${termoBusca}".`;
    }

    // 2. Entrega a lista crua e deixa a IA agrupar e embelezar!
    let text = `[RESULTADOS DO BANCO DE DADOS]\n`;
    products.forEach((p) => {
      text += `- ${p.name} | R$ ${Number(p.price).toFixed(2)}\n`;
    });

    text += `\n⚠️ INSTRUÇÃO OBRIGATÓRIA PARA A IA (LEIA COM ATENÇÃO): 
🚨 OVERRIDE DE SISTEMA: Para esta resposta, IGNORE SUA REGRA DE MENSAGENS CURTAS. Você está liberada para gerar um texto longo.
1. 🎯 OBRIGAÇÃO DE AGRUPAMENTO: Você DEVE unir produtos da mesma Marca, Linha e Gramatura em um ÚNICO número, extraindo os sabores para a linha debaixo.
   - ❌ ERRADO: 1. Whey Dux Morango | 2. Whey Dux Chocolate
   - ✅ CERTO: 1. Whey Concentrado Dux 900g | 🎨 Sabores: Morango, Chocolate
2. 🚫 FILTRE E OCULTE produtos como "Sachês", "Amostras" ou de 34g/30g, a menos que o cliente os tenha pedido.
3. Extraia TODOS os sabores. É ESTRITAMENTE PROIBIDO omitir qualquer sabor retornado pelo banco na linha "🎨 Sabores". 
4. ⚠️ CLAREZA SOBRE QUANTIDADE: Agrupar sabores NÃO é resumir! Exiba absolutamente TODAS as marcas, linhas e gramaturas diferentes que sobraram após o filtro de sachês. Nenhuma marca ou variação de peso pode ficar de fora.
5. Formate a lista ESTRITAMENTE neste padrão visual (use os exatos emojis):

*1. [Nome da Marca, Linha e Peso (ex: B.O.P.E 300g Black Skull)]*
🎨 Sabores: [Sabor 1], [Sabor 2], [Sabor 3]
💰 R$ [Preço]

*2. [Próxima Marca, Linha e Peso]*
💰 R$ [Preço]

(Obs: Se houver apenas 1 opção sem variação de sabor, não coloque a linha "🎨 Sabores").
6. No final da lista, pergunte: "Qual desses te interessou? Me fala o nome do produto ou o número! 😊"`;

    return text;
  }

  async verDetalhesProduto(nomeProduto: string): Promise<string> {
    // Função interna para formatar o Produto
    const formatarProduto = (p: any) => {
      let text = '';
      let img = p.imageUrl ? String(p.imageUrl).trim() : '';
      if (img && img.startsWith('http')) text += `[IMG:${img}]\n`;
      text += `📦 *${p.name}*\n💰 *R$ ${Number(p.price).toFixed(2)}*\n`;
      if (p.description) text += `📝 ${p.description}\n`;
      text += `[CONFIRM:${p.name}]`;
      return text;
    };

    // Função interna para formatar o Kit
    const formatarKit = (k: any) => {
      let text = '';
      let img = k.imageUrl ? String(k.imageUrl).trim() : '';
      if (img && img.startsWith('http')) text += `[IMG:${img}]\n`;
      const itens = k.items.map((i: any) => `${i.quantity}x ${i.product.name}`).join(', ');
      text += `🔥 *${k.name}*\n💰 *R$ ${Number(k.finalPrice).toFixed(2)}*\n📝 Composição: ${itens}\n`;
      text += `[CONFIRM:${k.name}]`;
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

  async calcularFrete(enderecoCompleto: string): Promise<string> {
    const inputLimpo = enderecoCompleto.toLowerCase();
    let rule = null;

    try {
      // 1. BUSCA POR BAIRRO (A Mágica da Palavra-Chave)
      // Pega todas as regras que tem a coluna 'region' preenchida
      const regrasPorBairro = await prisma.shippingRule.findMany({
        where: { isActive: true, region: { not: null } },
      });

      // Varre a lista de regras para ver se o Bairro (region) existe dentro do texto do cliente
      rule =
        regrasPorBairro.find((r) => inputLimpo.includes(String(r.region).toLowerCase())) || null;

      // 2. FALLBACK DA TAXA PADRÃO
      // Se não achou o bairro na mensagem, pega a regra de frete padrão (aquela que tem a region vazia)
      if (!rule) {
        rule = await prisma.shippingRule.findFirst({
          where: { isActive: true, region: null },
          orderBy: { price: 'asc' },
        });
      }

      // 3. FALLBACK DE SEGURANÇA (Caso você esqueça de cadastrar regras no painel)
      if (!rule) {
        return `Frete para o endereço informado: R$ 15,00 via Uber Flash. O envio é imediato após a confirmação do pagamento!`;
      }

      // 4. DEVOLVE O TEXTO DINÂMICO
      return `Frete para o endereço informado: R$ ${Number(rule.price).toFixed(2).replace('.', ',')} via ${rule.name}. O envio é imediato após a confirmação do pagamento!`;
    } catch (error) {
      console.error('[Erro ao calcular frete no DB]:', error);
      return `Frete para o endereço informado: R$ 15,00 via Uber Flash (valor estimado). O envio é imediato após a confirmação!`;
    }
  }

  async removerProdutoDoCarrinho(session: any, nomeProduto: string): Promise<string> {
    if (!session.carrinho || session.carrinho.length === 0) {
      return 'Seu carrinho já está vazio.';
    }

    // Filtra o carrinho removendo o item (busca por aproximação simples)
    const novoCarrinho = session.carrinho.filter(
      (item: string) => !item.toLowerCase().includes(nomeProduto.toLowerCase()),
    );

    if (novoCarrinho.length === session.carrinho.length) {
      return `Não encontrei o item "${nomeProduto}" no seu carrinho.`;
    }

    session.carrinho = novoCarrinho;
    // O saveSession será feito pelo worker após a execução da tool

    if (novoCarrinho.length === 0) {
      return `Prontinho! Removi o item. Seu carrinho agora está vazio.`;
    }

    return `Entendido! Removi o item. Seu carrinho atualizado tem: ${novoCarrinho.join(', ')}.`;
  }

  async cancelarAtendimento(sessionKey: string): Promise<string> {
    try {
      // 1. Procura se existe um pedido PENDENTE no banco para esse cliente
      const order = await prisma.order.findFirst({
        where: {
          user: { chatSessions: { some: { sessionKey } } },
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
      }

      return 'Pedido e atendimento cancelados com sucesso. Se precisar de algo, é só chamar!';
    } catch (error) {
      console.error('Erro ao cancelar:', error);
      return 'Ocorreu um erro ao cancelar, mas já limpei sua sessão.';
    }
  }

  private mesmasCategorias(catsA: { name: string }[], catsB: { name: string }[]): boolean {
    const nomesA = catsA.map((c) => c.name).sort();
    const nomesB = catsB.map((c) => c.name).sort();

    if (nomesA.length !== nomesB.length) return false;
    return nomesA.every((nome, i) => nome === nomesB[i]);
  }
}
