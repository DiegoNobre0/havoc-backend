import cron from 'node-cron';
import dayjs from 'dayjs';
import { prisma } from '../../database/prisma.js';
import { WhatsAppIntegrationService } from '../../integrations/whatsapp/whatsappIntegration.service.js';
import { redis } from '../redis/redis.js';

const whatsapp = new WhatsAppIntegrationService();

console.log('⏰ [Cron] Agendador de Recuperação de Carrinho Inicializado!');

// 🚀 Agenda a tarefa para rodar DE HORA EM HORA (Minuto 0 de cada hora)
cron.schedule('0 * * * *', async () => {
  console.log('🔍 [Cron] Iniciando varredura de leads perdidos...');

  try {
    // 1. Busca clientes parados há mais de 4 horas no meio do funil
    const limiteSuperior = dayjs().subtract(4, 'hours').toDate();

    // 2. Busca sessões que esfriaram no MEIO do funil e não excederam as tentativas
    const sessoesFrias = await prisma.chatSession.findMany({
      where: {
        updatedAt: {
          lte: limiteSuperior,
        },
        isActive: true, // O bot ainda tem o controle
        status: {
          in: ['EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'],
        },
        recoveryAttempts: { lt: 2 }, // Só busca quem tem 0 ou 1 tentativa
      },
    });

    if (sessoesFrias.length === 0) {
      console.log('🔍 [Cron] Nenhum lead frio encontrado nesta hora.');
      return;
    }

    console.log(`🔍 [Cron] Encontrados ${sessoesFrias.length} potenciais leads para recuperação.`);

    for (const sessao of sessoesFrias) {
      // 3. Cruzamento de dados: Verifica se esse número gerou algum pedido nas últimas 48h
      const pedidoExistente = await prisma.order.findFirst({
        where: {
          customerPhone: sessao.sessionKey,
          createdAt: { gte: dayjs().subtract(48, 'hours').toDate() },
        },
      });

      // Se o cliente já comprou de forma avulsa, marca a sessão como FINALIZADA e pula
      if (pedidoExistente) {
        await prisma.chatSession.updateMany({
          where: {
            id: sessao.id,
            isActive: true,
            status: { in: ['EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] },
            updatedAt: { lte: limiteSuperior },
          },
          data: { status: 'FINALIZADO', isActive: true },
        });
        continue;
      }

      const primeiroNome = sessao.customerName ? sessao.customerName.split(' ')[0] : '';
      const saudacao = primeiroNome ? `Oi, ${primeiroNome}!` : `Oii!`;

      try {
        // ── TENTATIVA 1: O Primeiro Lembrete (Após 4 horas de vácuo) ──
        if (sessao.recoveryAttempts === 0) {
          const claimed = await prisma.chatSession.updateMany({
            where: {
              id: sessao.id,
              isActive: true,
              status: { in: ['EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] },
              recoveryAttempts: 0,
              updatedAt: { lte: limiteSuperior },
            },
            data: { recoveryAttempts: 1, updatedAt: new Date() },
          });

          if (claimed.count === 0) continue;

          const msg1 = `${saudacao} Aqui é a Carol da Havoc de novo 🙋‍♀️\n\nVi que a gente conversou mais cedo e seu carrinho ficou aberto. Ficou alguma dúvida sobre os suplementos ou quer ajuda para fechar?`;

          await whatsapp.sendTextMessage(sessao.sessionKey, msg1);
          await prisma.chatMessage.create({
            data: { sessionId: sessao.id, role: 'ASSISTANT', content: msg1 },
          });

          console.log(`📩 [Resgate 1] Enviado para ${sessao.customerName || sessao.sessionKey}`);
        }

        // ── TENTATIVA 2: A Última Chamada (Mais 4 horas se passaram desde o lembrete 1) ──
        else if (sessao.recoveryAttempts === 1) {
          const claimed = await prisma.chatSession.updateMany({
            where: {
              id: sessao.id,
              isActive: true,
              status: { in: ['EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] },
              recoveryAttempts: 1,
              updatedAt: { lte: limiteSuperior },
            },
            data: {
              recoveryAttempts: 2,
              status: 'FINALIZADO',
              isActive: true,
              updatedAt: new Date(),
            },
          });

          if (claimed.count === 0) continue;

          const msg2 = `${saudacao} Carol aqui! Passando rápido só para avisar que o estoque de alguns itens que você olhou está baixando rápido hoje. 😱\n\nSe quiser garantir seus suplementos com o frete fixo de entrega, me avisa aqui para eu gerar seu Pix de checkout!`;

          await whatsapp.sendTextMessage(sessao.sessionKey, msg2);
          await prisma.chatMessage.create({
            data: { sessionId: sessao.id, role: 'ASSISTANT', content: msg2 },
          });

          console.log(
            `🚫 [Resgate 2 - Finalizado] Enviado para ${sessao.customerName || sessao.sessionKey}`,
          );
        }
      } catch (sendError) {
        console.error(`❌ [Cron] Erro ao enviar WhatsApp para ${sessao.sessionKey}:`, sendError);
      }
    }
  } catch (error) {
    console.error('❌ [Cron] Erro crítico na execução da varredura:', error);
  }
});

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
