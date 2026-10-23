import { DelayedError, Worker, Queue } from 'bullmq';
import { IAService } from './IA.service.js';
import { prisma } from '../../database/prisma.js';
import { redis } from '../../shared/redis/redis.js';
import { WhatsAppIntegrationService } from '../whatsapp/whatsappIntegration.service.js';
import { ChatbotContext } from './chatbot.context.js';
import { io } from '../../shared/socket/socket.js';
import { randomUUID } from 'node:crypto';

const iaService = new IAService();
const whatsapp = new WhatsAppIntegrationService();
const adminNotificationQueue = new Queue('admin-notifications', { connection: redis as any });

// ── Helpers Redis ────────────────────────────────────────────
const SESSION_TTL = 86_400;
const MAX_HISTORY = 30;

function sessionKey(key: string) {
  return `chat:session:${key}`;
}
function historyKey(key: string) {
  return `chat:history:${key}`;
}

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
  async (job, token) => {
    const { sessionKey: sKey, customerName, message } = job.data;

    // ── Lock — garante ordem por cliente ─────────────────────
    const lKey = `lock:${sKey}`;
    const lockToken = randomUUID();
    const lock = await (redis as any).set(lKey, lockToken, 'EX', 120, 'NX');

    if (!lock) {
      await job.moveToDelayed(Date.now() + 2000, token);
      throw new DelayedError();
    }

    const lockRenewer = setInterval(async () => {
      try {
        await (redis as any).eval(
          `if redis.call('get', KEYS[1]) == ARGV[1] then
             return redis.call('expire', KEYS[1], ARGV[2])
           end
           return 0`,
          1,
          lKey,
          lockToken,
          120,
        );
      } catch (error) {
        console.error(`[Worker] Falha ao renovar lock de ${sKey}:`, error);
      }
    }, 30_000);

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
            : '⚠️ Não encontrei nenhuma conversa para apagar.',
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
      let dbSession = await prisma.chatSession.upsert({
        where: { sessionKey: sKey },
        create: { sessionKey: sKey, customerName, isActive: true, status: 'NOVO_ATENDIMENTO' },
        update: { customerName, recoveryAttempts: 0 },
      });

      if (dbSession.status === 'FINALIZADO' || dbSession.status === 'CANCELADO') {
        console.log(`[Worker] 🔄 Cliente ${sKey} voltou! Reabrindo sessão...`);

        dbSession = await prisma.chatSession.update({
          where: { id: dbSession.id },
          data: {
            status: 'NOVO_ATENDIMENTO',
            isActive: true,
            recoveryAttempts: 0,
          },
        });
      }

      let session = await getSession(sKey);
      if (session) {
        session.customerName = customerName || session.customerName;
        session.isActive = dbSession.isActive;
      } else {
        session = {
          sessionKey: sKey,
          customerName,
          isActive: dbSession.isActive,
          id: dbSession.id,
        };
      }

      await saveSession(sKey, session);

      if (!session.isActive) {
        console.log(`[Worker] 👨‍💻 Sessão com Humano. Salvando mensagem sem chamar a IA.`);

        if (io) {
          io.to(`chat_${sKey}`).emit('new_message', { role: 'USER', content: textoFinal });
          io.to('all_chats').emit('chat_updated', {
            id: dbSession.id,
            sessionKey: sKey,
            lastMessage: textoFinal,
            role: 'USER',
            status: dbSession.status,
            isActive: dbSession.isActive,
          });
        }
        await prisma.chatSession
          .upsert({
            where: { sessionKey: sKey },
            create: {
              sessionKey: sKey,
              customerName,
              isActive: false,
              status: 'ATENDIMENTO_HUMANO',
            },
            update: { customerName },
          })
          .then((dbSession) =>
            prisma.chatMessage.create({
              data: {
                sessionId: dbSession.id,
                role: 'USER',
                content: textoFinal,
              },
            }),
          )
          .catch((e) => console.error('[Prisma Background Error]:', e));

        return;
      }

      const textoMinusculo = textoFinal?.toLowerCase() || '';

      // Encerra despedidas simples sem acionar o modelo.
      const encerramentos = [
        'certo',
        'ok',
        'obrigado',
        'obrigada',
        'valeu',
        'ta bom',
        'beleza',
        'tá ótimo',
        'ta certo',
        'obg',
        'obgda',
        'blz',
      ];

      if (encerramentos.includes(textoMinusculo)) {
        console.log(
          `[Worker] 🤫 Cliente encerrou a conversa com "${textoMinusculo}". Finalizando sessão.`,
        );

        await prisma.chatSession.update({
          where: { sessionKey: sKey },
          data: {
            status: 'FINALIZADO',
            isActive: true,
            handoffRequestedAt: null,
          },
        });

        // Limpa a memória pra garantir
        await (redis as any).del(sessionKey(sKey));
        await (redis as any).del(historyKey(sKey));

        return; // 👈 O GRANDE SEGREDO: O return para o código aqui! A IA não é chamada e não responde nada.
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
          role: 'USER',
          status: dbSession.status,
          isActive: dbSession.isActive,
        });
      }

      await prisma.chatMessage.create({
        data: {
          sessionId: dbSession.id,
          role: 'USER',
          content: textoParaHistorico,
        },
      });

      const aiResponse = await iaService.generateResponse(session, textoFinal, history);
      const persistedControl = await prisma.chatSession.findUnique({
        where: { sessionKey: sKey },
        select: { status: true, isActive: true },
      });

      if (persistedControl) {
        dbSession.status = persistedControl.status;
        dbSession.isActive = persistedControl.isActive;
      }

      if (!dbSession.isActive && !aiResponse.handoff) {
        console.log(
          `[Worker] Atendimento assumido por humano durante a geração. Resposta da IA descartada.`,
        );
        return;
      }

      const shouldResetSession =
        dbSession.status === 'FINALIZADO' || dbSession.status === 'CANCELADO';

      if (!shouldResetSession) {
        await saveSession(sKey, session);
      }

      // ── Handoff ──────────────────────────────────────────────
      if (aiResponse.handoff) {
        console.log(`[Worker] ⚠️ Handoff solicitado.`);
        session.isActive = false;
        session.handoffRequestedAt = new Date().toISOString();
        await saveSession(sKey, session);

        dbSession = await prisma.chatSession.upsert({
          where: { sessionKey: sKey },
          create: {
            sessionKey: sKey,
            customerName,
            isActive: false,
            status: 'ATENDIMENTO_HUMANO',
            handoffRequestedAt: new Date(),
          },
          update: {
            isActive: false,
            status: 'ATENDIMENTO_HUMANO',
            customerName,
            handoffRequestedAt: new Date(),
          },
        });

        await adminNotificationQueue.add('handoff-request', {
          sessionKey: sKey,
          lastMessage: textoFinal,
          requestedAt: new Date().toISOString(),
        });
      }

      // ── Envio ────────────────────────────────────────────────
      if (aiResponse.content) {
        const imgRegex = /\[IMG:(.*?)\]/gi;
        const imagesToSend: string[] = [];
        let imgMatch;
        while ((imgMatch = imgRegex.exec(aiResponse.content)) !== null) {
          imagesToSend.push(imgMatch[1].trim());
        }

        console.log(`\n[DEBUG IA RAW] Resposta bruta da IA:\n${aiResponse.content}\n`);

        const finalContent = aiResponse.content
          .replace(/\[IMG:[\s\S]*?\]/gi, '')
          .replace(/<function[^>]*>[\s\S]*?<\/function>/g, '')
          .replace(/\[CATALOG_URL:(https?:\/\/[^\]]+)\]/gi, '$1')
          .trim();

        if (finalContent) {
          if (!shouldResetSession) {
            await pushHistory(sKey, 'ASSISTANT', finalContent);
          }
          if (io) {
            io.to(`chat_${sKey}`).emit('new_message', { role: 'ASSISTANT', content: finalContent });
            io.to('all_chats').emit('chat_updated', {
              id: dbSession.id,
              sessionKey: sKey,
              lastMessage: finalContent,
              role: 'ASSISTANT',
              status: dbSession.status,
              isActive: dbSession.isActive,
            });
          }
        }

        await prisma.chatSession
          .upsert({
            where: { sessionKey: sKey },
            create: { sessionKey: sKey, customerName, isActive: true },
            update: { customerName, updatedAt: new Date() },
          })
          .then((sessaoAtualizada) =>
            prisma.chatMessage.create({
              data: {
                sessionId: sessaoAtualizada.id,
                role: 'ASSISTANT',
                content: aiResponse.content || '',
                tokens: aiResponse.tokens,
              },
            }),
          )
          .catch((e) => console.error('[Prisma Background Error]:', e));

        for (const imgUrl of imagesToSend) {
          await whatsapp.sendImageMessage(sKey, imgUrl);
        }
        if (finalContent) {
          await whatsapp.sendTextMessage(sKey, finalContent);
        }
        console.log(`[WhatsApp] ✅ Resposta enviada para ${sKey}`);
      }

      if (shouldResetSession) {
        await (redis as any).del(sessionKey(sKey));
        await (redis as any).del(historyKey(sKey));
      }

      console.log(`🏁 [Worker] Job ${job.id} finalizado.`);
    } catch (error) {
      console.error(`❌ [Worker] Falha no Job ${job.id}:`, error);
      throw error;
    } finally {
      clearInterval(lockRenewer);
      await (redis as any).eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then
           return redis.call('del', KEYS[1])
         end
         return 0`,
        1,
        lKey,
        lockToken,
      );
    }
  },
  {
    connection: redis as any,
    lockDuration: 60000,
    lockRenewTime: 20000,
  },
);

chatbotWorker.on('failed', (job, err) => console.error(`🚨 [Worker] Job ${job?.id} falhou:`, err));

chatbotWorker.on('completed', (job) => console.log(`✅ [Worker] Job ${job.id} concluído.`));

// ─── CRON JOB DE FAXINA (RODA A CADA 1 HORA) ──────────────────────
setInterval(
  async () => {
    try {
      // Define o tempo limite: Considera inativo quem não manda mensagem há 2 horas
      const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Busca conversas inativas para limpeza de sessão.
      const sessoesInativas = await prisma.chatSession.findMany({
        where: {
          isActive: true,
          updatedAt: { lt: duasHorasAtras },
          status: 'NOVO_ATENDIMENTO',
        },
      });

      for (const session of sessoesInativas) {
        const claimed = await prisma.chatSession.updateMany({
          where: {
            id: session.id,
            isActive: true,
            status: 'NOVO_ATENDIMENTO',
            updatedAt: { lt: duasHorasAtras },
          },
          data: { status: 'FINALIZADO', isActive: true, handoffRequestedAt: null },
        });

        if (claimed.count === 0) continue;

        // 2. Limpa o Redis para o cliente não voltar com lixo do passado no dia seguinte
        await (redis as any).del(`chat:session:${session.sessionKey}`);
        await (redis as any).del(`chat:history:${session.sessionKey}`);
      }

      if (sessoesInativas.length > 0) {
        console.log(
          `🧹 [Cron Job] ${sessoesInativas.length} sessões abandonadas há mais de 2h foram encerradas.`,
        );
      }
    } catch (error) {
      console.error('❌ [Cron Error]:', error);
    }
  },
  60 * 60 * 1000,
);
