import pino from 'pino';
import { env } from '../env/index.js'; // Lembre-se do .js no final dos imports em projetos ESM (module: NodeNext)

export const logger = pino({
  level: env.NODE_ENV === 'dev' ? 'debug' : 'info',
  // Se for 'dev', ele espalha (adiciona) a propriedade transport dentro do objeto.
  // Se não for, ele não faz nada (não adiciona a chave).
  ...(env.NODE_ENV === 'dev' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
  }),
});