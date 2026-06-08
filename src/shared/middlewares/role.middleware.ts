import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/AppError.js';

/**
 * Middleware de Autorização Baseado em Cargos (RBAC)
 * @param allowedRoles Array de roles permitidas (ex: ['ADMIN', 'OPERADOR'])
 */
type UserRole = 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR';

export function authorizeRoles(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub, role } = request.user; // já tipado via fastify-jwt.d.ts

    if (!role) {
      throw new AppError('Usuário não autenticado ou permissão não encontrada no token.', 401);
    }

    if (!allowedRoles.includes(role)) {
      throw new AppError(
        'Acesso negado. Seu cargo não tem permissão para realizar esta ação.',
        403,
      );
    }
  };
}
