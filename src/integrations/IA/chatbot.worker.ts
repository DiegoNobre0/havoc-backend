import { Worker, Queue } from 'bullmq';
import { IAService } from './IA.service.js';
import { prisma } from '../../database/prisma.js';
import { redis } from '../../shared/redis/redis.js';
import { WhatsAppIntegrationService } from '../whatsapp/whatsappIntegration.service.js';
import { ChatbotContext } from './chatbot.context.js';
import { io } from '../../shared/socket/socket.js';

const iaService = new IAService();
const whatsapp = new WhatsAppIntegrationService();
const adminNotificationQueue = new Queue('admin-notifications', { connection: redis as any });

// ── Helpers Redis ────────────────────────────────────────────
const SESSION_TTL = 86_400;
const MAX_HISTORY = 30;

function sessionKey(key: string) { return `chat:session:${key}`; }
function historyKey(key: string) { return `chat:history:${key}`; }

async function getSession(key: string) {
  const data = await (redis as any).get(sessionKey(key));
  return data ? JSON.parse(data) : null;
}

async function saveSession(key: string, data: object) {
  await (redis as any).set(sessionKey(key), JSON.stringify(data), 'EX', SESSION_TTL);
}

async function getHistory(key: string): Promise<Array<{ role: string; content: string }>> {
  const data = await (redis as any).get(historyKey(key));
  return data ? JSON.parse(data) : [];
}

async function pushHistory(key: string, role: string, content: string) {
  const history = await getHistory(key);
  history.push({ role, content });
  const trimmed = history.slice(-MAX_HISTORY);
  await (redis as any).set(historyKey(key), JSON.stringify(trimmed), 'EX', SESSION_TTL);
  return trimmed;
}
// ─────────────────────────────────────────────────────────────

console.log('🤖 [Worker] Inicializando Chatbot Worker...');

export const chatbotWorker = new Worker(
  'whatsapp-queue',
  async (job) => {
    const { sessionKey: sKey,customerName, message } = job.data;

    // ── Lock — garante ordem por cliente ─────────────────────
    const lKey = `lock:${sKey}`;
    const lock = await (redis as any).set(lKey, '1', 'EX', 120, 'NX');

    const lockRenewer = setInterval(async () => {
      await (redis as any).expire(lKey, 120);
      console.log(`[Worker] 🔄 Lock renovado para ${sKey}`);
    }, 30_000);

    if (!lock) {
      await job.moveToDelayed(Date.now() + 2000);
      return;
    }

    try {
      // ── Comando especial /excluir ────────────────────────────
      if (message.content?.trim().toLowerCase() === '/excluir') {
        const context = new ChatbotContext();
        const resultado = await context.excluirConversa(sKey);
        await (redis as any).del(sessionKey(sKey));
        await (redis as any).del(historyKey(sKey));
        await whatsapp.sendTextMessage(
          sKey,
          resultado === 'ok'
            ? '✅ Conversa apagada com sucesso.'
            : '⚠️ Não encontrei nenhuma conversa para apagar.'
        );
        return;
      }

      // ── Multimodal ───────────────────────────────────────────
      let textoFinal = message.content;
      let textoParaHistorico = message.content;

      if (message.type === 'audio') {
        console.log(`[Worker] 🎤 Áudio (ID: ${message.content})`);
        const buf = await whatsapp.downloadMedia(message.content);
        textoFinal = buf
          ? await iaService.transcribeAudio(buf)
          : '[O cliente enviou um áudio, mas falhou ao carregar]';
        console.log(`[Worker] 🗣️ Transcrito: "${textoFinal}"`);
      } else if (message.type === 'image') {
        console.log(`[Worker] 📸 Imagem (ID: ${message.content})`);
        const buf = await whatsapp.downloadMedia(message.content);
        if (buf) {
          const descricao = await iaService.analyzeImage(buf.toString('base64'));
          textoFinal = `[FOTO RECEBIDA] 
Visão identificou: "${descricao}". 
⚠️ INSTRUÇÃO DO SISTEMA: O cliente quer ESSE item da foto. Ative a VIA EXPRESSA! 
1. Inicie a frase sendo educada, dê um "Bom dia/Boa tarde" com energia e confirme que foi procurar o item da foto.
2. Pule as etapas Iniciais e chame as ferramentas de busca (listar_produtos ou listar_kits_promocionais) AGORA buscando por "${descricao}".`;
        } else {
          textoFinal = '[O cliente enviou uma imagem, mas falhou ao carregar]';
        }
      }

      // ── Sessão ───────────────────────────────────────────────
      let session = await getSession(sKey);
      if (!session) {
        session = { sessionKey: sKey, isActive: true, id: sKey, carrinho: [] };
        await saveSession(sKey, session);
      }

      // 1. Garante que temos a sessão no banco para ver o status real
      let dbSession = await prisma.chatSession.upsert({
        where: { sessionKey: sKey },
        create: { sessionKey: sKey, customerName, isActive: true, status: 'NOVO_ATENDIMENTO' },
        update: {customerName} // Só busca, não altera nada ainda
      });

      // 2. Se estava morta (Finalizada/Cancelada), nós reabrimos!
      if (dbSession.status === 'FINALIZADO' || dbSession.status === 'CANCELADO') {
        console.log(`[Worker] 🔄 Cliente ${sKey} voltou! Reabrindo sessão...`);
        
        dbSession = await prisma.chatSession.update({
          where: { id: dbSession.id },
          data: { 
            status: 'NOVO_ATENDIMENTO', // Volta pra aba "Abertos"
            isActive: true // Devolve o controle pra IA
          }
        });

        // Atualiza a memória do Redis na mesma hora pra IA não ficar calada
        session.isActive = true;
        await saveSession(sKey, session);
      }

      if (!session.isActive) {
        console.log(`[Worker] 👨‍💻 Sessão com Humano. Salvando mensagem sem chamar a IA.`);

        // 1. Avisa o Angular instantaneamente para aparecer na tela
       if (io) {
          io.to(`chat_${sKey}`).emit('new_message', { role: 'USER', content: textoFinal });
          io.to('all_chats').emit('chat_updated', { 
            id: dbSession.id, // 👉 ENVIANDO O ID REAL DO PRISMA AQUI
            sessionKey: sKey, 
            lastMessage: textoFinal, 
            role: 'USER' 
          });
        }
        // 2. Salva a mensagem no banco de dados para o histórico do painel
        await prisma.chatSession.upsert({
          where: { sessionKey: sKey },
          create: { sessionKey: sKey, customerName, isActive: false },
          update: {customerName},
        }).then((dbSession) =>
          prisma.chatMessage.create({
            data: {
              sessionId: dbSession.id,
              role: 'USER',
              content: textoFinal
            }
          })
        ).catch((e) => console.error('[Prisma Background Error]:', e));

        
    
        return;
      }     


      // No worker, ANTES de chamar a IA, adicione este interceptador:
      const ehNumero = /^\d+$/.test(textoFinal?.trim() || '');

      if (ehNumero) {
        const listaCache = await (redis as any).get(`lista_produtos:${sKey}`);
        if (listaCache) {
          const lista: string[] = JSON.parse(listaCache);
          const indice = parseInt(textoFinal.trim()) - 1;
          const nomeProduto = lista[indice];

          if (nomeProduto) {
            textoParaHistorico = `Quero ver o produto: ${nomeProduto}`;
            textoFinal = `[FORCAR_DETALHES:${nomeProduto}]
O cliente escolheu o item ${textoFinal} da lista, que corresponde a "${nomeProduto}".
⚠️ INSTRUÇÃO DO SISTEMA: Chame IMEDIATAMENTE a ferramenta 'ver_detalhes_do_produto' passando EXATAMENTE "${nomeProduto}".`;
          }
        } else {
          // 👉 FALLBACK NOVO: Se o Redis sumiu, obriga a IA a olhar o contexto e chamar a tool
          textoFinal = `O cliente digitou a opção número "${textoFinal}".
⚠️ INSTRUÇÃO DO SISTEMA: Chame a ferramenta 'ver_detalhes_do_produto' AGORA passando o NOME COMPLETO do item ${textoFinal} que você listou na sua última mensagem. NÃO repasse a descrição da sua memória.`;
        }
      }

      // ── Interceptadores de Botões de Ação ────────────────────

      const textoMinusculo = textoFinal?.toLowerCase() || '';

      // 1. Confirmação do Produto ("Sim, é esse!")
      if (textoFinal?.includes('CONFIRM_YES') || textoFinal?.includes('[PRODUTO_CONFIRMADO]') || textoMinusculo.includes('sim, é esse')) {
        let nomeProduto = textoFinal.replace('[PRODUTO_CONFIRMADO]', '').replace('CONFIRM_YES:', '').trim();
        if (nomeProduto.includes('Sim, é esse')) nomeProduto = 'Produto Anterior';

        textoParaHistorico = `Sim, é esse! Produto: ${nomeProduto}`;

        session.carrinho = session.carrinho || [];
        session.carrinho.push(nomeProduto);
        await saveSession(sKey, session);

        const carrinhoTexto = session.carrinho.join(', ');

        textoFinal = `[TAG DO SISTEMA: O cliente clicou no botão "Sim, é esse!" e confirmou o produto]
O produto "${nomeProduto}" foi salvo no carrinho!
Carrinho atual: ${carrinhoTexto}

Siga ESTRITAMENTE este formato:
1. Confirme: "Ótimo! *${nomeProduto}* adicionado ao carrinho! 💪"
2. Sugira UMA CATEGORIA complementar (ex: Creatina, BCAA, Pré-Treino). NUNCA cite marca ou gramatura.
3. Pergunte: "Quer dar uma olhada nessa sugestão ou prefere fechar o pedido agora?"
4. OBRIGATÓRIO na última linha: [SUGESTAO:Nome Do Produto];

Exemplo OBRIGATÓRIO do final da sua resposta:
Quer dar uma olhada nessa sugestão ou prefere fechar o pedido agora?
[SUGESTAO:Nome Do Produto]`;
      }

      // 2. Botão de Ver Sugestão (Upsell)
      else if (textoFinal?.includes('VER_SUGESTAO_') || textoFinal?.includes('[VER_SUGESTAO]') || textoMinusculo.includes('ver sugestão')) {
        // Extrai o nome do produto que veio do botão
        let termoSugerido = '';
        if (textoFinal.includes('VER_SUGESTAO_')) {
          termoSugerido = textoFinal.replace('VER_SUGESTAO_', '').trim();
        } else if (textoFinal.includes('[VER_SUGESTAO]')) {
          termoSugerido = textoFinal.replace(/\[VER_SUGESTAO\]/g, '').trim();
        }

        console.log(`[DEBUG INTERCEPTADOR] Cliente clicou em ver sugestão. Termo capturado: "${termoSugerido}"`);

        textoParaHistorico = 'Quero ver a sugestão que você me deu.';

        // Se conseguimos capturar o termo, forçamos a busca exata. Se não, deixamos a IA tentar deduzir.
       const instrucaoBusca = termoSugerido
          ? `⚠️ INSTRUÇÃO DO SISTEMA: Você sugeriu "${termoSugerido}". Chame a ferramenta 'listar_produtos' AGORA. DICA VITAL: Não envie a palavra inteira para a ferramenta. Use sua inteligência para enviar apenas a RAIZ da palavra (ex: se for Creatina, envie 'creatin') para o banco encontrar tanto as versões em português quanto as em inglês.`
          : `⚠️ INSTRUÇÃO DO SISTEMA: Olhe para a sua última mensagem. O que você sugeriu? Chame a ferramenta 'listar_produtos' AGORA buscando por essa sugestão. Lembre-se de enviar apenas a RAIZ da palavra (ex: 'creatin' no lugar de creatina).`;

        textoFinal = `[FORCAR_BUSCA]
O cliente quer ver as opções da sugestão de upsell.
${instrucaoBusca}
NÃO busque o produto anterior (que já está no carrinho).`;
      }

      // 3. Botão de Ver Outros (Recusou ou quer mais opções)
      else if (textoFinal?.includes('CONFIRM_NO') || textoMinusculo.includes('ver outros') || textoMinusculo.includes('outras opções')) {
        textoParaHistorico = 'Quero ver outras opções.';
        textoFinal = `[FORCAR_BUSCA]
O cliente quer ver OUTRAS opções da categoria que ele estava olhando.
Gere os argumentos e chame a ferramenta listar_produtos AGORA buscando mais alternativas. Mostre apenas os produtos REAIS retornados pelo banco.`;
      }

      // 4. Botão de Finalizar Pedido
      else if (textoFinal?.includes('CONFIRM_CHECKOUT') || textoFinal?.includes('[FINALIZAR_PEDIDO]') || textoMinusculo.includes('finalizar pedido')) {
        const carrinhoTexto = (session.carrinho || []).join(', ');
        textoParaHistorico = 'Quero finalizar o pedido.';
        textoFinal = `[FINALIZAR_PEDIDO] 
O cliente clicou no botão para fechar o pedido.
Carrinho atual: ${carrinhoTexto}.
⚠️ INSTRUÇÃO DO SISTEMA: Inicie a ETAPA 6 agora. Execute APENAS o PASSO 1 do Checkout (pergunte sobre Retirada ou Entrega e pare).`;
      }

      // ── Histórico + IA ───────────────────────────────────────
     const history = await getHistory(sKey);
      await pushHistory(sKey, 'USER', textoFinal);

      if (io) {       
        io.to(`chat_${sKey}`).emit('new_message', { role: 'USER', content: textoParaHistorico });
        io.to('all_chats').emit('chat_updated', { 
            id: dbSession.id, 
            sessionKey: sKey, 
            lastMessage: textoParaHistorico, 
            role: 'USER' 
        });
      }

      await prisma.chatMessage.create({
        data: {
          sessionId: dbSession.id, // Usa a variável dbSession que criamos no início do arquivo
          role: 'USER',
          content: textoParaHistorico
        }
      });

      const aiResponse = await iaService.generateResponse(session, textoFinal, history);
      await saveSession(sKey, session); 

      // ── Handoff ──────────────────────────────────────────────
      if (aiResponse.handoff) {
        console.log(`[Worker] ⚠️ Handoff solicitado.`);
        session.isActive = false;
        session.handoffRequestedAt = new Date().toISOString();
        await saveSession(sKey, session);

        await prisma.chatSession.upsert({
          where: { sessionKey: sKey },
          create: { sessionKey: sKey,customerName, isActive: false, handoffRequestedAt: new Date() },
          update: {  isActive: false, customerName, handoffRequestedAt: new Date() },
        });

        

        await adminNotificationQueue.add('handoff-request', {
          sessionKey: sKey,
          lastMessage: textoFinal,
          requestedAt: new Date().toISOString(),
        });
      }

      // ── Envio ────────────────────────────────────────────────
      if (aiResponse.content) {
        const imgRegex = /\[IMG:(.*?)\]/g;
        const confirmTagParaLimpar = /\[CONFIRM:(.*?)\]/g;
        const toolTagRegex = /<function[^>]*>[\s\S]*?<\/function>/g;

        const imagesToSend: string[] = [];
        let match;

        while ((match = imgRegex.exec(aiResponse.content)) !== null) {
          imagesToSend.push(match[1]);
        }

        console.log(`\n[DEBUG IA RAW] Resposta bruta da IA:\n${aiResponse.content}\n`);

        const confirmMatch = aiResponse.content.match(/\[CONFIRM:(.*?)\]/);
        const productName = confirmMatch?.[1] ?? null;

       // 1. Regex à prova de erros (pega SUGESTAO com 1 ou 2 G's)
        const sugestaoMatch = aiResponse.content.match(/\[SUG+ESTAO:(.*?)\]/i);

        // 2. Extrai o produto
        let produtoSugerido = sugestaoMatch ? sugestaoMatch[1].trim() : '';
        // Se a IA colocar um ponto e vírgula no final da tag por engano, nós limpamos
        produtoSugerido = produtoSugerido.replace(';', '').trim();

        const pixMatch = aiResponse.content.match(/\[PIX:(.*?)\]/i);
        const pixCode = pixMatch ? pixMatch[1].trim() : null;

        console.log(`[DEBUG TAG] Produto Sugerido Extraído: "${produtoSugerido}"`);

        // 👉 LIMPANDO TUDO DA TELA DO CLIENTE
        let finalContent = aiResponse.content
          .replace(imgRegex, '')
          .replace(confirmTagParaLimpar, '')
          .replace(toolTagRegex, '')
          .replace(/\[SUGESTAO:(.*?)\]/gi, '')   // Limpa o normal
          .replace(/\[SUGGESTAO:(.*?)\]/gi, '')  // Limpa o erro de ortografia da IA
          .replace(/;/g, '') // Remove possíveis pontos e vírgulas perdidos pela IA
          .replace(/\[PIX:(.*?)\]/gi, '')
          .trim();

        // 3. Agora sim, isso só será True se a IA gerou a tag ou fez a pergunta
        const hasUpsellButtons = produtoSugerido !== '' || finalContent.toLowerCase().includes('dar uma olhada');
        finalContent = finalContent.replace(/\[BOTOES_UPSELL\]/g, '').trim();

        if (finalContent) {
          await pushHistory(sKey, 'ASSISTANT', finalContent);
          if (io) {
            io.to(`chat_${sKey}`).emit('new_message', { role: 'ASSISTANT', content: finalContent });
            io.to('all_chats').emit('chat_updated', { 
              id: dbSession.id, // 👉 ENVIANDO O ID REAL DO PRISMA AQUI TAMBÉM
              sessionKey: sKey, 
              lastMessage: finalContent, 
              role: 'ASSISTANT'
            });
          }
        }

        // Persiste no Prisma em background...
     // Persiste a resposta da IA no Prisma em background...
        prisma.chatSession.upsert({
          where: { sessionKey: sKey },
          create: { sessionKey: sKey,customerName, isActive: true },
          update: { customerName, updatedAt: new Date() }, // Atualiza a hora da sessão
        }).then((sessaoAtualizada) =>
          
          // 👉 CORREÇÃO 2: Cria apenas a mensagem da IA, pois a do cliente já foi salva!
          prisma.chatMessage.create({
            data: { 
              sessionId: sessaoAtualizada.id, 
              role: 'ASSISTANT', 
              content: aiResponse.content || '', 
              tokens: aiResponse.tokens 
            }
          })

        ).catch((e) => console.error('[Prisma Background Error]:', e));

        // LÓGICA DE ENVIO MULTIMÍDIA E BOTÕES
        if (productName) {
          // Cenário 1: Confirmação do Produto
          await whatsapp.sendInteractiveImageMessage(
            sKey,
            finalContent || 'O que achou desse?',
            imagesToSend.length > 0 ? imagesToSend[0] : '',
            [
              { id: `CONFIRM_YES:${productName}`, title: '✅ Sim, é esse!' },
              { id: `CONFIRM_NO_${Date.now()}`, title: '🔄 Ver outros' },
              { id: `CONFIRM_CHECKOUT_${Date.now()}`, title: '🛒 Finalizar pedido' }
            ]
          );
        } else if (hasUpsellButtons) {
          // Cenário 2: Upsell BLINDADO (Se a frase estiver no texto, os botões aparecem)

          // Se a IA não gerou a tag, mandamos um Fallback pro Webhook não quebrar
          const idBotaoSugestao = produtoSugerido ? `VER_SUGESTAO_${produtoSugerido}` : `VER_SUGESTAO_FALLBACK`;

          await whatsapp.sendInteractiveImageMessage(
            sKey,
            finalContent,
            '',
            [
              { id: idBotaoSugestao, title: '👀 Ver sugestão' },
              { id: `CONFIRM_CHECKOUT_${Date.now()}`, title: '🛒 Finalizar pedido' }
            ]
          );
        } else {
          // Cenário 3: Mensagem normal
          for (const imgUrl of imagesToSend) {
            await whatsapp.sendImageMessage(sKey, imgUrl);
          }
          if (finalContent) {
            await whatsapp.sendTextMessage(sKey, finalContent);
          }
          if (pixCode) {
            await whatsapp.sendTextMessage(sKey, pixCode);
            console.log(`[WhatsApp] 💸 Código PIX enviado separado para ${sKey}`);
          }

        }
        console.log(`[WhatsApp] ✅ Resposta enviada para ${sKey}`);
      }

      console.log(`🏁 [Worker] Job ${job.id} finalizado.`);

    } catch (error) {
      console.error(`❌ [Worker] Falha no Job ${job.id}:`, error);
      throw error;
    } finally {
      // Sempre libera o lock
      clearInterval(lockRenewer);
      await (redis as any).del(lKey);
    }
  },
  {
    connection: redis as any,
    lockDuration: 60000,
    lockRenewTime: 20000,
  }
);

chatbotWorker.on('failed', (job, err) =>
  console.error(`🚨 [Worker] Job ${job?.id} falhou:`, err));

chatbotWorker.on('completed', (job) =>
  console.log(`✅ [Worker] Job ${job.id} concluído.`));