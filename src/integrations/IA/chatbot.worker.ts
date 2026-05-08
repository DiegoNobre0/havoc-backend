import { Worker, Queue } from 'bullmq';
import { IAService } from './IA.service.js';
import { prisma } from '../../database/prisma.js';
import { redis } from '../../shared/redis/redis.js';
import { WhatsAppIntegrationService } from '../whatsapp/whatsappIntegration.service.js';
import { ChatbotContext } from './chatbot.context.js';

const iaService = new IAService();
const whatsapp = new WhatsAppIntegrationService();
const adminNotificationQueue = new Queue('admin-notifications', { connection: redis as any });

// ── Helpers Redis ────────────────────────────────────────────
const SESSION_TTL = 86_400;
const MAX_HISTORY = 6;

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
    const { sessionKey: sKey, message } = job.data;

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

      // ✅ INTERCEPTA CONFIRMAÇÃO DE PRODUTO PARA FORÇAR UPSELL
      if (textoFinal?.startsWith('[PRODUTO_CONFIRMADO]')) {
        const nomeProduto = textoFinal.replace('[PRODUTO_CONFIRMADO]', '').trim();
        textoParaHistorico = `Sim, é esse! Produto: ${nomeProduto}`; // ✅ Texto limpo no histórico
        textoFinal = `[PRODUTO_CONFIRMADO] ${nomeProduto} — sugira 1 complemento em 1 linha após confirmar.`;
      }


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
          textoFinal = `[Cliente enviou imagem. Visão identificou: "${descricao}"]. Carol, atenda com base nisso.`;
        } else {
          textoFinal = '[O cliente enviou uma imagem, mas falhou ao carregar]';
        }
      }

      // ── Sessão ───────────────────────────────────────────────
      let session = await getSession(sKey);
      if (!session) {
        session = { sessionKey: sKey, isActive: true, id: sKey };
        await saveSession(sKey, session);
      }

      if (!session.isActive) {
        console.log(`[Worker] ✋ Sessão em handoff. Ignorando.`);
        return;
      }

      // Após o bloco [PRODUTO_CONFIRMADO], salva no carrinho da sessão: z      

      if (textoFinal?.startsWith('[PRODUTO_CONFIRMADO]')) {
        const nomeProduto = textoFinal.replace('[PRODUTO_CONFIRMADO]', '').trim();
        textoParaHistorico = `Sim, é esse! Produto: ${nomeProduto}`;

        // ✅ Salva no carrinho da sessão
        session.carrinho = session.carrinho || [];
        session.carrinho.push(nomeProduto);
        await saveSession(sKey, session);

        const carrinhoTexto = session.carrinho.join(', ');

        // 👇 SUBSTITUA O textoFinal POR ESTE BLOCO 👇
        // whatsapp.worker.ts (dentro do bloco do [PRODUTO_CONFIRMADO])
        textoFinal = `[TAG DO SISTEMA: O cliente clicou no botão "Sim, é esse!" e confirmou o produto]
INSTRUÇÃO DE UPSELL: O produto "${nomeProduto}" foi salvo no carrinho!
CARRINHO ATUAL: ${carrinhoTexto}
Siga EXATAMENTE estes 3 passos agora:
1. Confirme com energia colocando o nome do produto em NEGRITO (usando asteriscos): "Ótimo! *${nomeProduto}* adicionado ao seu carrinho! 💪"
2. Faça uma VENDA CASADA: Sugira 1 suplemento complementar que NÃO esteja no carrinho seguindo ESTA ORDEM ESTRITA. Coloque a sugestão OBRIGATORIAMENTE em NEGRITO (usando asteriscos):
   - Se ainda não tem Creatina no carrinho -> Sugira *Creatina*.
   - Se já tem Creatina, mas não tem BCAA -> Sugira *BCAA*.
   - Se já tem Whey, Creatina e BCAA -> Sugira um *Pré-Treino* para energia extra.
3. Termine perguntando: "Quer dar uma olhada nessa sugestão ou prefere fechar o pedido agora?"
⚠️ IMPORTANTE: OBRIGATORIAMENTE adicione a tag [BOTOES_UPSELL] no final da sua resposta.
NÃO repita informações e NÃO pergunte sobre formas de pagamento ainda.`;
      }

      // ✅ Trata o botão de finalizar
      if (textoFinal?.startsWith('[FINALIZAR_PEDIDO]')) {
        const carrinhoTexto = (session.carrinho || []).join(', ');
        textoParaHistorico = 'Quero finalizar o pedido';
        textoFinal = `[FINALIZAR_PEDIDO] Cliente quer fechar. Carrinho: ${carrinhoTexto}. Inicie o checkout agora: pergunte retirada ou entrega.`;
      }

      // ── Histórico + IA ───────────────────────────────────────
      const history = await getHistory(sKey);
      await pushHistory(sKey, 'USER', textoFinal);

      const aiResponse = await iaService.generateResponse(session, textoFinal, history);

      // ── Handoff ──────────────────────────────────────────────
      if (aiResponse.handoff) {
        console.log(`[Worker] ⚠️ Handoff solicitado.`);
        session.isActive = false;
        session.handoffRequestedAt = new Date().toISOString();
        await saveSession(sKey, session);

        await prisma.chatSession.upsert({
          where: { sessionKey: sKey },
          create: { sessionKey: sKey, isActive: false, handoffRequestedAt: new Date() },
          update: { isActive: false, handoffRequestedAt: new Date() },
        });

        await adminNotificationQueue.add('handoff-request', {
          sessionKey: sKey,
          lastMessage: textoFinal,
          requestedAt: new Date().toISOString(),
        });
      }

      // ── Envio ────────────────────────────────────────────────
   // ── Envio ────────────────────────────────────────────────
      if (aiResponse.content) {
        const imgRegex = /\[IMG:(.*?)\]/g;
        const confirmRegex = /\[CONFIRM:(.*?)\]/;
        const toolTagRegex = /<function[^>]*>[\s\S]*?<\/function>/g;

        const imagesToSend: string[] = [];
        let match;

        while ((match = imgRegex.exec(aiResponse.content)) !== null) {
          imagesToSend.push(match[1]);
        }

        const confirmMatch = aiResponse.content.match(confirmRegex);
        const productName = confirmMatch?.[1] ?? null;

        let finalContent = aiResponse.content
          .replace(imgRegex, '')
          .replace(confirmRegex, '')
          .replace(toolTagRegex, '')
          .trim();

        // 👇 NOVA LÓGICA: Verifica se tem a tag de Upsell e limpa ela
        const hasUpsellButtons = finalContent.includes('[BOTOES_UPSELL]');
        if (hasUpsellButtons) {
          finalContent = finalContent.replace('\[BOTOES_UPSELL\]', '').trim();
        }

        if (finalContent) await pushHistory(sKey, 'ASSISTANT', finalContent);

        // Persiste no Prisma em background...
        prisma.chatSession.upsert({
          where: { sessionKey: sKey },
          create: { sessionKey: sKey },
          update: {},
        }).then((dbSession) =>
          prisma.chatMessage.createMany({
            data: [
              { sessionId: dbSession.id, role: 'USER', content: textoParaHistorico },
              { sessionId: dbSession.id, role: 'ASSISTANT', content: finalContent, tokens: aiResponse.tokens },
            ],
          })
        ).catch((e) => console.error('[Prisma Background Error]:', e));

        // 👇 NOVA LÓGICA DE ENVIO
        if (imagesToSend.length > 0 && productName) {
          // Cenário 1: Mostrando os detalhes de um produto com foto
          await whatsapp.sendInteractiveImageMessage(
            sKey,
            finalContent || 'É esse produto que você quer?',
            imagesToSend[0],
            [
              { id: `CONFIRM_YES:${productName}`, title: '✅ Sim, é esse!' },
              { id: 'CONFIRM_NO', title: '🔄 Ver outros' },
              { id: 'CONFIRM_CHECKOUT', title: '🛒 Finalizar pedido' }
            ]
          );
        } else if (hasUpsellButtons) {
          // Cenário 2: Fazendo Upsell (Manda botões sem foto)
          await whatsapp.sendInteractiveImageMessage(
            sKey,
            finalContent,
            '', // Sem URL de imagem
            [
              { id: 'VER_SUGESTAO', title: '👀 Ver sugestão' },
              { id: 'CONFIRM_CHECKOUT', title: '🛒 Finalizar pedido' }
            ]
          );
        } else {
          // Cenário 3: Mensagem normal (Só texto ou imagens simples)
          for (const imgUrl of imagesToSend) {
            await whatsapp.sendImageMessage(sKey, imgUrl);
          }
          if (finalContent) {
            await whatsapp.sendTextMessage(sKey, finalContent);
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