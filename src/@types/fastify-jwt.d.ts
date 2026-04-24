import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR';
    };
    user: {
      sub: string;
      role: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR';
    };
  }
}