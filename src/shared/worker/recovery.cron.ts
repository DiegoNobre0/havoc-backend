import cron from 'node-cron';
import dayjs from 'dayjs';
import { prisma } from '../../database/prisma.js';
import { WhatsAppIntegrationService } from '../../integrations/whatsapp/whatsappIntegration.service.js';

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
        await prisma.chatSession.update({
          where: { id: sessao.id },
          data: { status: 'FINALIZADO' },
        });
        continue;
      }

      const primeiroNome = sessao.customerName ? sessao.customerName.split(' ')[0] : '';
      const saudacao = primeiroNome ? `Oi, ${primeiroNome}!` : `Oii!`;

      try {
        // ── TENTATIVA 1: O Primeiro Lembrete (Após 4 horas de vácuo) ──
        if (sessao.recoveryAttempts === 0) {
          const msg1 = `${saudacao} Aqui é a Carol da Havoc de novo 🙋‍♀️\n\nVi que a gente conversou mais cedo e seu carrinho ficou aberto. Ficou alguma dúvida sobre os suplementos ou quer ajuda para fechar?`;

          await whatsapp.sendTextMessage(sessao.sessionKey, msg1);
          await prisma.chatMessage.create({
            data: { sessionId: sessao.id, role: 'ASSISTANT', content: msg1 },
          });

          // Atualiza para 1 tentativa. O updatedAt vira "agora", dando +4h de respiro pro cliente.
          await prisma.chatSession.update({
            where: { id: sessao.id },
            data: { recoveryAttempts: 1 },
          });

          console.log(`📩 [Resgate 1] Enviado para ${sessao.customerName || sessao.sessionKey}`);
        }

        // ── TENTATIVA 2: A Última Chamada (Mais 4 horas se passaram desde o lembrete 1) ──
        else if (sessao.recoveryAttempts === 1) {
          const msg2 = `${saudacao} Carol aqui! Passando rápido só para avisar que o estoque de alguns itens que você olhou está baixando rápido hoje. 😱\n\nSe quiser garantir seus suplementos com o frete fixo de entrega, me avisa aqui para eu gerar seu Pix de checkout!`;

          await whatsapp.sendTextMessage(sessao.sessionKey, msg2);
          await prisma.chatMessage.create({
            data: { sessionId: sessao.id, role: 'ASSISTANT', content: msg2 },
          });

          // Como é a segunda e última tentativa, finaliza o atendimento definitivamente
          await prisma.chatSession.update({
            where: { id: sessao.id },
            data: {
              recoveryAttempts: 2,
              status: 'FINALIZADO', // Sai do funil ativo e vai para o arquivo
            },
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
      // 3. Devolve o controle para a IA e desvincula o usuário humano
      await prisma.chatSession.update({
        where: { id: sessao.id },
        data: {
          isActive: true,
          status: 'NOVO_ATENDIMENTO', // Volta para a tela inicial do seu Dashboard
          userId: null, // Tira o chat da caixa de entrada do funcionário
          recoveryAttempts: 0, // Zera para permitir nova recuperação futura se necessário
        },
      });

      // 🔥 4. OPCIONAL (MAS RECOMENDADO): Avisa o cliente que a IA voltou
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
