import cron from 'node-cron';
import dayjs from 'dayjs';
import { prisma } from '../../database/prisma.js';
import { WhatsAppIntegrationService } from '../../integrations/whatsapp/whatsappIntegration.service.js';
import { redis } from '../redis/redis.js';

const whatsapp = new WhatsAppIntegrationService();

console.log('⏰ [Cron] Agendador de limpeza de atendimentos inicializado.');

// ============================================================================
// 🚀 AGENDADOR 2: DEVOLUÇÃO AUTOMÁTICA PARA A IA (A CADA 15 MINUTOS)
// ============================================================================
cron.schedule('*/15 * * * *', async () => {
  console.log('🔄 [Cron] Verificando chats esquecidos por humanos...');

  try {
    // 1. Define o limite de tempo: 1 hora sem enviar ou receber mensagens
    const limiteInatividade = dayjs().subtract(1, 'hour').toDate();

    // 2. Busca sessões que estão com o humano (isActive: false) e inativas
    const sessoesEsquecidas = await prisma.chatSession.findMany({
      where: {
        isActive: false,
        status: 'ATENDIMENTO_HUMANO',
        updatedAt: {
          lte: limiteInatividade,
        },
      },
    });

    if (sessoesEsquecidas.length === 0) return;

    console.log(
      `🔄 [Cron] Resgatando ${sessoesEsquecidas.length} chats esquecidos pelos atendentes.`,
    );

    for (const sessao of sessoesEsquecidas) {
      // Apenas uma instância pode concluir a transição e enviar o aviso.
      const claimed = await prisma.chatSession.updateMany({
        where: {
          id: sessao.id,
          isActive: false,
          status: 'ATENDIMENTO_HUMANO',
          updatedAt: { lte: limiteInatividade },
        },
        data: {
          isActive: true,
          status: 'FINALIZADO',
          userId: null, // Tira da caixa de entrada do funcionário
          handoffRequestedAt: null,
          recoveryAttempts: 0,
          updatedAt: new Date(),
        },
      });

      if (claimed.count === 0) continue;

      // 👉 COLOQUE AQUI! Limpa a memória do Redis logo após atualizar o banco de dados
      await (redis as any).del(`chat:session:${sessao.sessionKey}`);
      await (redis as any).del(`chat:history:${sessao.sessionKey}`);

      // 🔥 4. Avisa o cliente que o atendimento foi encerrado
      const primeiroNome = sessao.customerName ? sessao.customerName.split(' ')[0] : '';
      const saudacao = primeiroNome ? `Oi, ${primeiroNome}!` : `Oii!`;

      const mensagemRetorno = `${saudacao} O seu atendimento com nossa equipe foi encerrado devido ao tempo de inatividade. A Carol assumiu por aqui novamente! 🙋‍♀️\n\nSe ainda precisar de ajuda com seus suplementos, é só mandar mensagem!`;

      try {
        await whatsapp.sendTextMessage(sessao.sessionKey, mensagemRetorno);

        await prisma.chatMessage.create({
          data: {
            sessionId: sessao.id,
            role: 'ASSISTANT',
            content: mensagemRetorno,
          },
        });
      } catch (err) {
        console.error(
          `❌ [Cron] Erro ao enviar mensagem de retomada para ${sessao.sessionKey}`,
          err,
        );
      }
    }
  } catch (error) {
    console.error('❌ [Cron] Erro na varredura de retomada de IA:', error);
  }
});
