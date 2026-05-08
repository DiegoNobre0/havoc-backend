import { prisma } from '../../database/prisma.js';

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
  // 2. Busca os Kits Promocionais ativos
  async getPromoKitsContext(): Promise<string> {
    const activeKits = await prisma.kit.findMany({
      where: { isActive: true },
      include: {
        items: {
          include: { product: { select: { name: true } } },
        },
      },
      take: 5,
    });

    if (activeKits.length === 0) return 'Nenhum kit promocional ativo no momento.';

    let text = '\n🔥 KITS PROMOCIONAIS IMPERDÍVEIS:\n\n';

    activeKits.forEach((kit, index) => {
      const itemsList = kit.items
        .map((i) => `${i.quantity}x ${i.product.name}`)
        .join(', ');

      text += `${index + 1}. *${kit.name}*: R$ ${Number(kit.finalPrice).toFixed(2)}\n`;
      text += `Composição: ${itemsList}\n\n`;
    });

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
      take: 4, // Traz no máximo 4 opções para não poluir o WhatsApp do cliente
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
      if (p.description) text += `📝 ${p.description}\n`;
      text += `\n`;
    }

    return text;
  }


  // 👉 NOVA FUNÇÃO: Transforma a conversa em um Pedido Real no banco
  // 👉 NOVA FUNÇÃO: Transforma a conversa em um Pedido Real no banco (AGORA ACEITANDO KITS!)
  async gerarCheckout(sessionKey: string, dadosCheckout: any): Promise<string> {
    try {
      // 1. Busca o usuário dono desse telefone, ou cria um na hora
      let user = await prisma.user.findFirst({ /* lógica para achar o user pelo telefone da sessionKey */ });

      if (!user) {
        user = await prisma.user.findFirst(); // Mock rápido para não quebrar
      }

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
          continue; // Achou como produto, pula pro próximo item do laço
        }

        // --- TENTATIVA 2: É UM KIT PROMOCIONAL? ---
        const kitBanco = await prisma.kit.findFirst({
          where: { name: { contains: item.nome_produto, mode: 'insensitive' } },
          include: { items: true } // Traz os itens que compõem o kit
        });

        if (kitBanco) {
          const itemTotal = Number(kitBanco.finalPrice) * item.quantidade;
          subtotal += itemTotal;

          // DESEMPACOTAMENTO: Adiciona os produtos do kit no pedido individualmente
          for (const kitItem of kitBanco.items) {
            orderItemsData.push({
              productId: kitItem.productId,
              quantity: kitItem.quantity * item.quantidade,
              // Registra o valor unitário como zero (ou simbólico) pois o valor total do pedido já absorveu o preço final do kit
              unitPrice: 0,
              totalPrice: 0,
            });
          }
          continue; // Achou como kit, pula pro próximo item
        }

        // --- SE CHEGOU AQUI, A IA INVENTOU NOME OU O ESTOQUE ZEROU ---
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

      // 5. DEVOLVE O TEXTO PRONTO PARA A IA MANDAR PRO CLIENTE
      let textoResposta = `✅ *Pedido #${novoPedido.code} Gerado com Sucesso!*\n\n`;
      textoResposta += `*Resumo da Compra:*\n`;

      // Itera em cima dos nomes originais que a IA capturou (Kit ou Produto)
      dadosCheckout.produtos.forEach((p: any) => {
        textoResposta += `- ${p.quantidade}x ${p.nome_produto}\n`;
      });

      textoResposta += `\nSubtotal: R$ ${subtotal.toFixed(2)}`;
      textoResposta += `\nFrete: R$ ${frete.toFixed(2)}`;
      textoResposta += `\n*TOTAL: R$ ${total.toFixed(2)}*\n\n`;

      if (dadosCheckout.metodo_pagamento === 'PIX') {
        textoResposta += `👇 *PAGAMENTO VIA PIX* 👇\n`;
        textoResposta += `Copia e Cola: \`00020126360014BR.GOV.BCB.PIX... (Seu Pix aqui)\`\n\n`;
        textoResposta += `Assim que fizer o pagamento, me envie o comprovante por aqui mesmo para eu liberar seu pedido na expedição! 🚀`;
      } else if (dadosCheckout.metodo_pagamento === 'CARTAO') {
        textoResposta += `💳 Para pagar no cartão de crédito, acesse seu link seguro: https://checkout.havoc.com.br/pay/${novoPedido.code}`;
      } else {
        textoResposta += `💵 Pagamento em dinheiro selecionado. Deixe o valor separado para entregar ao motoboy (ou no balcão). Precisa de troco?`;
      }

      return textoResposta;

    } catch (error) {
      console.error('[Erro ao gerar checkout]:', error);
      return "Ocorreu um erro interno ao gerar o número do pedido. Avise ao cliente que você vai chamar um humano para finalizar a venda.";
    }
  }


  // LISTA: Só texto, sem foto — para a primeira apresentação
  async listarProdutos(termoBusca: string): Promise<string> {
    // 1. Quebra o termo buscado em palavras separadas (Ex: "proteina black skull" vira ["proteina", "black", "skull"])
    const termos = termoBusca.split(' ').filter(t => t.trim().length > 0);

    // 2. Exige que TODAS as palavras digitadas apareçam no produto (seja no nome, descrição ou categoria)
    const condicoesAND = termos.map(termo => ({
      OR: [
        { name: { contains: termo, mode: 'insensitive' as const } },
        { description: { contains: termo, mode: 'insensitive' as const } },
        { categories: { some: { name: { contains: termo, mode: 'insensitive' as const } } } }
      ]
    }));

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        AND: condicoesAND // Aqui entra a nossa busca inteligente
      },
      take: 4,
      select: {
        name: true,
        price: true,
        description: true,
      }
    });

    if (products.length === 0) {
      return `Não encontrei produtos para "${termoBusca}".`;
    }

    let text = `Encontrei essas opções pra você 👇\n\n`;
    products.forEach((p, i) => {
      text += `*${i + 1}. ${p.name}*\n`;
      text += `💰 R$ ${Number(p.price).toFixed(2)}\n`;
      if (p.description) text += `${p.description}\n`;
      text += `\n`;
    });

    text += `_Qual desses te interessou? Me fala o nome do produto ou o número!_`;

    return text;
  }


  // DETALHE: Com foto — quando o cliente escolher um produto OU KIT específico
  // DETALHE: Com foto — quando o cliente escolher um produto OU KIT específico
  async verDetalhesProduto(nomeProduto: string): Promise<string> {
    const testImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Gatto_europeo4.jpg/800px-Gatto_europeo4.jpg'; // Substitua pela sua URL oficial

    // 1. Quebra o termo buscado em palavras separadas (Mini-Google)
    const termos = nomeProduto.split(' ').filter(t => t.trim().length > 0);
    const condicoesAND = termos.map(termo => ({
      name: { contains: termo, mode: 'insensitive' as const }
    }));

    // 2. TENTA BUSCAR NOS PRODUTOS ISOLADOS
    const product = await prisma.product.findFirst({
      where: {
        isActive: true,
        stock: { gt: 0 },
        AND: condicoesAND // <-- Busca inteligente aqui
      },
      select: {
        name: true,
        price: true,
        description: true,
        imageUrl: true, 
      }
    });

    if (product) {
      let imageUrl = (product as any).imageUrl;
      if (!imageUrl || !imageUrl.startsWith('http')) imageUrl = testImageUrl;

      let text = `[IMG:${imageUrl}]\n`;
      text += `📦 *${product.name}*\n`;
      text += `💰 *R$ ${Number(product.price).toFixed(2)}*\n`;
      if (product.description) text += `📝 ${product.description}\n`;
      text += `[CONFIRM:${product.name}]`;
      return text;
    }

    // 3. SE NÃO ACHOU, TENTA BUSCAR NOS KITS PROMOCIONAIS
    const kit = await prisma.kit.findFirst({
      where: {
        isActive: true,
        AND: condicoesAND // <-- Busca inteligente para os kits também
      },
      include: {
        items: {
          include: { product: { select: { name: true } } }
        }
      }
    });

    if (kit) {
      let kitImageUrl = (kit as any).imageUrl;
      if (!kitImageUrl || !kitImageUrl.startsWith('http')) kitImageUrl = testImageUrl;

      const itemsList = kit.items.map((i) => `${i.quantity}x ${i.product.name}`).join(', ');

      let text = `[IMG:${kitImageUrl}]\n`;
      text += `🔥 *${kit.name}*\n`;
      text += `💰 *R$ ${Number(kit.finalPrice).toFixed(2)}*\n`;
      text += `📝 Composição: ${itemsList}\n`;
      text += `[CONFIRM:${kit.name}]`;
      return text;
    }

    // 4. SE NÃO ACHOU EM NENHUM DOS DOIS
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
}