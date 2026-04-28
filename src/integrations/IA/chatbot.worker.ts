import { Worker } from 'bullmq';
import { IAService } from './IA.service.js';
import { prisma } from '../../database/prisma.js';
import { redis } from '../../shared/redis/redis.js';;
import { WhatsAppIntegrationService } from '../whatsapp/whatsappIntegration.service.js';


const iaService = new IAService();
const whatsapp = new WhatsAppIntegrationService(); 

export const chatbotWorker = new Worker('whatsapp-queue', async (job) => {
  const { sessionKey, message } = job.data;

  // 1. Busca ou cria a Sessão (Telefone = sessionKey)
  let session : any = await prisma.chatSession.findUnique({
    where: { sessionKey },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } } // Pega últimas 20 msgs
  });

  if (!session) {
    session = await prisma.chatSession.create({
      data: { sessionKey },
      include: { messages: true }
    });
  }

  // 2. Trava de Handoff (Se estiver falando com humano, o bot dorme)
  // Usamos isActive=false para indicar que o bot está pausado para esta pessoa
  if (!session.isActive) {
    console.log(`Bot ignorou mensagem de ${sessionKey} (Modo Humano ativado).`);
    return;
  }

  // 3. Salva a mensagem do Cliente no Histórico
  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: 'USER',
      content: message.content
    }
  });

  // 4. Inverte as mensagens para mandar pro Groq na ordem cronológica certa
  const history = session.messages.reverse();

  // 5. O Cérebro Pensa e Responde
  const aiResponse = await iaService.generateResponse(session, message.content, history);

  // 6. Trata o Handoff Humano (A IA decidiu que precisa de humano)
  if (aiResponse.handoff) {
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { isActive: false } // Pausa o bot
    });
    // Dispara notificação pro painel Admin que um cliente precisa de ajuda aqui!
  }

  // 7. Salva a resposta da IA no banco
  if (aiResponse.content) {
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: aiResponse.content,
        tokens: aiResponse.tokens
      }
    });

    // 8. Envia para o WhatsApp!
    await whatsapp.sendTextMessage(sessionKey, aiResponse.content);
  }

}, { connection: redis as any });

chatbotWorker.on('failed', (job, err) => {
  console.error(`❌ Job do Chatbot Falhou: ${job?.id}`, err);
});