import { Server as SocketIOServer } from 'socket.io';

export let io: SocketIOServer;

// 👇 Recebe o 'server' cru em vez do app inteiro do Fastify
export function setupSocket(server: any) {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] 🟢 Cliente conectado: ${socket.id}`);

    socket.on('join_order', (orderId: string) => {
      socket.join(`order_${orderId}`);
    });

    socket.on('join_chat', (sessionKey: string) => {
      socket.join(`chat_${sessionKey}`);
      console.log(`[Socket.io] 🎧 Painel escutando o chat do número: ${sessionKey}`);
    });

    socket.on('leave_chat', (sessionKey: string) => {
      socket.leave(`chat_${sessionKey}`);
    });

    socket.on('join_chat_list', () => {
      socket.join('all_chats'); 
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] 🔴 Cliente desconectado: ${socket.id}`);
    });
  });
}