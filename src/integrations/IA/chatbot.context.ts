import { prisma } from '../../database/prisma.js';
import { PaymentsService } from '../../modules/payments/payments.service.js';
import { redis } from '../../shared/redis/redis.js';

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
          `Pedido #${order.id.split('-')[0].toUpperCase()} | Status: ${order.status} | Total: R$ ${Number(order.total).toFixed(2)}`
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
          { categories: { some: { name: { contains: termoBusca, mode: 'insensitive' } } } }
        ]
      },
      take: 10, // Traz no máximo 4 opções para não poluir o WhatsApp do cliente
      select: {
        id: true,
        name: true,
        price: true,
        description: true,
        imageUrl: true, // ✅ Agora vem de verdade
        categories: { select: { name: true } }
      }

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
      // 1. Busca o usuário dono desse telefone, ou cria um na hora
      let user = await prisma.user.findFirst({ /* lógica para achar o user pelo telefone da sessionKey */ });

      // if (!user) {
      //   user = await prisma.user.findFirst(); 
      // }

      let subtotal = 0;
      const orderItemsData = [];
      const itensNaoEncontrados = [];

      // 2. Itera sobre os produtos/kits que a IA enviou
      for (const item of dadosCheckout.produtos) {
        // --- TENTATIVA 1: É UM PRODUTO ISOLADO? ---
        const produtoBanco = await prisma.product.findFirst({
          where: { name: { contains: item.nome_produto, mode: 'insensitive' } }
        });

        if (produtoBanco) {
          const itemTotal = Number(produtoBanco.price) * item.quantidade;
          subtotal += itemTotal;

          orderItemsData.push({
            productId: produtoBanco.id,
            quantity: item.quantidade,
            unitPrice: produtoBanco.price,
            totalPrice: itemTotal,
          });
          continue;
        }

        // --- TENTATIVA 2: É UM KIT PROMOCIONAL? ---
        const kitBanco = await prisma.kit.findFirst({
          where: { name: { contains: item.nome_produto, mode: 'insensitive' } },
          include: { items: true }
        });

        if (kitBanco) {
          const itemTotal = Number(kitBanco.finalPrice) * item.quantidade;
          subtotal += itemTotal;

          for (const kitItem of kitBanco.items) {
            orderItemsData.push({
              productId: kitItem.productId,
              quantity: kitItem.quantity * item.quantidade,
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

      // 3. Calcula Frete Fixo
      const frete = dadosCheckout.metodo_entrega === 'ENTREGA' ? 15.00 : 0.00;
      const total = subtotal + frete;

      // 4. CRIA O PEDIDO NO BANCO
      const novoPedido = await prisma.order.create({
        data: {
          code: `HAV-${Math.floor(Math.random() * 10000)}`,
          userId: user!.id,
          status: 'PENDING',
          subtotal,
          shippingCost: frete,
          total,
          notes: `Entrega: ${dadosCheckout.metodo_entrega} | Endereço: ${dadosCheckout.endereco_ou_cep || 'N/A'}\n*Atenção*: Se houver itens com valor zero, eles fazem parte de um Kit Promocional.`,
          items: {
            create: orderItemsData
          },
          statusHistory: {
            create: [{ status: 'PENDING', note: 'Pedido gerado via WhatsApp (IA)' }]
          }
        }
      });

      // 🔥 5. INTEGRAÇÃO MERCADO PAGO: Gera a cobrança na hora 🔥
      const paymentsService = new PaymentsService();
      let pixCopiaECola = '';
      let linkPagamento = '';

      if (dadosCheckout.metodo_pagamento === 'PIX') {
        const pixData = await paymentsService.generatePix(
          novoPedido.id,
          'cliente@havoc.com.br', // E-mail obrigatório do MP
          'Cliente Havoc'         // Nome obrigatório do MP
        );
        // 👇 Pega o código gerado pelo Mercado Pago
        pixCopiaECola = pixData.pixCode || '';

      } else if (dadosCheckout.metodo_pagamento === 'CARTAO') {
        const linkData = await paymentsService.generateLink(novoPedido.id);
        linkPagamento = linkData.paymentLink || '';
      }

      // 6. DEVOLVE O TEXTO PRONTO PARA A IA MANDAR PRO CLIENTE
      let textoResposta = `✅ *Pedido #${novoPedido.code} Gerado com Sucesso!*\n\n`;
      textoResposta += `*Resumo da Compra:*\n`;

      dadosCheckout.produtos.forEach((p: any) => {
        textoResposta += `- ${p.quantidade}x ${p.nome_produto}\n`;
      });

      textoResposta += `\nSubtotal: R$ ${subtotal.toFixed(2)}`;
      textoResposta += `\nFrete: R$ ${frete.toFixed(2)}`;
      textoResposta += `\n*TOTAL: R$ ${total.toFixed(2)}*\n\n`;

      // 7. INJETA O QR CODE E AS INSTRUÇÕES DE PAGAMENTO NO FINAL
      if (dadosCheckout.metodo_pagamento === 'PIX') {

        if (pixCopiaECola) {
          const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixCopiaECola)}`;
          textoResposta = `[IMG:${qrCodeUrl}]\n` + textoResposta;
          // Injeta a tag mágica do PIX
          textoResposta += `\n[PIX:${pixCopiaECola}]`;
        }

        textoResposta += `👇 *PAGAMENTO VIA PIX* 👇\n`;
        textoResposta += `Para pagar, escaneie o *QR Code* da imagem acima ou copie o código abaixo.\n`;
        textoResposta += `_(Enviamos o código copia-e-cola em uma mensagem separada para facilitar para você!)_\n\n`;
        textoResposta += `Assim que o pagamento for aprovado, nosso sistema confirma tudo automaticamente por aqui! 🚀`;

      } else if (dadosCheckout.metodo_pagamento === 'CARTAO') {
        textoResposta += `💳 *PAGAMENTO NO CARTÃO* 💳\n`;
        textoResposta += `Acesse seu link seguro do Mercado Pago para finalizar a compra em até 12x:\n\n`;
        textoResposta += `${linkPagamento}\n\n`;
        textoResposta += `Após o pagamento, seu pedido será confirmado automaticamente! 🚀`;
      } else {
        textoResposta += `💵 Pagamento em dinheiro selecionado. Deixe o valor separado para entregar ao motoboy (ou no balcão). Precisa de troco?`;
      }

      return textoResposta;

    } catch (error) {
      console.error('[Erro ao gerar checkout]:', error);
      return "Ocorreu um erro interno ao gerar o número do pedido. Avise ao cliente que você vai chamar um humano para finalizar a venda.";
    }
  }

async listarProdutos(termoBusca: string): Promise<string> {
    // 1. Limpeza inteligente e Tradução Universal de Suplementos
    let termoLimpo = termoBusca
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Tira acentos
      .toLowerCase();

    // Dicionário de palavras inúteis
    const palavrasInuteis = [
      'preciso', 'quero', 'de', 'um', 'uma', 'gostaria', 'comprar', 'busco', 'ver', 'tem', 'sugestao',
      'promocao', 'promo', 'unidades', 'unidade', 'pack', 'com', 'x', 'para', 'o', 'a', 'e',
      'powder', 'dietary', 'supplement', 'suplemento', 'flavor', 'sabor', 'nutrition', 'advanced', 'formula'
    ];

    // Filtra palavras inúteis e números isolados
    const termos = termoLimpo.split(' ').filter(t => t.trim().length > 1 && !palavrasInuteis.includes(t) && isNaN(Number(t)));

    if (termos.length === 0) {
      return 'Por favor, seja mais específico no nome do produto.';
    }

    // 👉 Alterei levemente a chave de cache para não dar conflito com o cache antigo que tinha kits
    const searchKey = termos.join('-');
    const cacheKey = `chatbot:busca:isolada:${searchKey}`;

    // Tenta buscar no Redis O(1) antes de bater no banco
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`⚡ [Redis] Retornando busca por "${searchKey}" do Cache!`);
        return cached;
      }
    } catch (err) {
      console.error('⚠️ [Redis Error] Falha ao ler cache, buscando no DB...', err);
    }

    const condicoesAND = termos.map(termo => ({
      name: { contains: termo, mode: 'insensitive' as const }
    }));

    // 2. BUSCA EXCLUSIVA NOS PRODUTOS ISOLADOS (A Mágica da Limpeza)
    const products = await prisma.product.findMany({
      where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND },
      take: 4, // 👈 TRAVA DE SEGURANÇA: Mostra no máximo 4 opções
      select: { name: true, price: true }
    });

    if (products.length === 0) {
      return `Não encontrei produtos exatamente para "${termoBusca}".`;
    }

    let text = `Encontrei essas opções pra você 👇\n\n`;
    let contador = 1;

    // Lista apenas os produtos isolados
    products.forEach((p) => {
      text += `*${contador}. ${p.name}*\n💰 R$ ${Number(p.price).toFixed(2)}\n\n`;
      contador++;
    });

    text += `_Qual desses te interessou? Me fala o nome do produto ou o número!_`;

    // Salva o resultado da busca no Redis por 30 minutos (1800 segundos)
    try {
      await redis.set(cacheKey, text, 'EX', 1800);
    } catch (err) {
      console.error('⚠️ [Redis Error] Falha ao salvar cache:', err);
    }

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
      where: { name: { equals: nomeProduto.trim(), mode: 'insensitive' }, isActive: true, stock: { gt: 0 } }
    });
    if (produtoExato) return formatarProduto(produtoExato);

    const kitExato = await prisma.kit.findFirst({
      where: { name: { equals: nomeProduto.trim(), mode: 'insensitive' }, isActive: true },
      include: { items: { include: { product: { select: { name: true } } } } }
    });
    if (kitExato) return formatarKit(kitExato);

    // 👉 TENTATIVA 2: FALLBACK (Busca fragmentada caso o cliente tenha digitado só um pedaço na mão)
    let termoLimpo = nomeProduto
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Tira acentos
      .toLowerCase();

    const palavrasInuteis = [
      'promocao', 'promo', 'unidades', 'unidade', 'pack', 'de', 'com', 'x', 'para', 'o', 'a', 'e',
      'powder', 'dietary', 'supplement', 'suplemento', 'flavor', 'sabor', 'nutrition', 'advanced', 'formula'
    ];

    const termos = termoLimpo.split(' ').filter((t: string) => t.trim().length > 1 && !palavrasInuteis.includes(t) && isNaN(Number(t)));

    if (termos.length === 0) return `O item "${nomeProduto}" não foi encontrado.`;

    const condicoesAND = termos.map((termo: string) => ({
      name: { contains: termo, mode: 'insensitive' as const }
    }));

    const buscandoKit = termos.includes('kit');

    if (buscandoKit) {
      const kitEncontrado = await prisma.kit.findFirst({ where: { isActive: true, AND: condicoesAND }, include: { items: { include: { product: { select: { name: true } } } } } });
      if (kitEncontrado) return formatarKit(kitEncontrado);

      const prodEncontrado = await prisma.product.findFirst({ where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND } });
      if (prodEncontrado) return formatarProduto(prodEncontrado);
    } else {
      const prodEncontrado = await prisma.product.findFirst({ where: { isActive: true, stock: { gt: 0 }, AND: condicoesAND } });
      if (prodEncontrado) return formatarProduto(prodEncontrado);

      const kitEncontrado = await prisma.kit.findFirst({ where: { isActive: true, AND: condicoesAND }, include: { items: { include: { product: { select: { name: true } } } } } });
      if (kitEncontrado) return formatarKit(kitEncontrado);
    }

    return `O item "${nomeProduto}" não foi encontrado no estoque ou nas promoções ativas.`;
  }


  async excluirConversa(sessionKey: string): Promise<string> {
    try {
      const session = await prisma.chatSession.findUnique({
        where: { sessionKey },
        select: { id: true }
      });

      if (!session) {
        return 'Nenhuma conversa encontrada para esse número.';
      }

      // 1. Apaga as mensagens primeiro (FK constraint)
      const { count } = await prisma.chatMessage.deleteMany({
        where: { sessionId: session.id }
      });

      // 2. Apaga a sessão
      await prisma.chatSession.delete({
        where: { id: session.id }
      });

      console.log(`[Excluir] 🗑️ ${count} mensagens + sessão ${session.id} deletadas.`);
      return `ok`;

    } catch (error) {
      console.error('[Excluir Conversa Error]:', error);
      return `erro`;
    }
  }

  async removerProdutoDoCarrinho(session: any, nomeProduto: string): Promise<string> {
    if (!session.carrinho || session.carrinho.length === 0) {
      return "Seu carrinho já está vazio.";
    }

    // Filtra o carrinho removendo o item (busca por aproximação simples)
    const novoCarrinho = session.carrinho.filter((item: string) => 
      !item.toLowerCase().includes(nomeProduto.toLowerCase())
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
          status: 'PENDING' 
        },
        orderBy: { createdAt: 'desc' }
      });

      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' }
        });
      }

      return "Pedido e atendimento cancelados com sucesso. Se precisar de algo, é só chamar!";
    } catch (error) {
      console.error('Erro ao cancelar:', error);
      return "Ocorreu um erro ao cancelar, mas já limpei sua sessão.";
    }
  }
}