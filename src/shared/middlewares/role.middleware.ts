import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/AppError.js';

/**
 * Middleware de Autorização Baseado em Cargos (RBAC)
 * @param allowedRoles Array de roles permitidas (ex: ['ADMIN', 'OPERADOR'])
 */
export function authorizeRoles(allowedRoles: ('ADMIN' | 'OPERADOR' | 'VISUALIZADOR')[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    
    // O verify-jwt (que roda antes deste) salva o payload do token no request.user
    // Precisamos pegar a role de lá.
    const user = request.user as { sub: string; role: string } | undefined;

    if (!user || !user.role) {
      throw new AppError('Usuário não autenticado ou permissão não encontrada no token.', 401);
    }

    // Verifica se a role do usuário está dentro do array de roles permitidas para esta rota
    if (!allowedRoles.includes(user.role as any)) {
      throw new AppError('Acesso negado. Seu cargo não tem permissão para realizar esta ação.', 403);
    }
  };
}