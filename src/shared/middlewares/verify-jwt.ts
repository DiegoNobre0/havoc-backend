import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../../database/prisma.js';

// ✅ adicionar após jwtVerify
export async function verifyJwt(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();

    // Garante que o usuário ainda está ativo no banco
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { isActive: true, deletedAt: true },
    });

    if (!user || !user.isActive || user.deletedAt) {
      throw new AppError('Usuário inativo ou removido.', 401);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Não autorizado. Token ausente, expirado ou inválido.', 401);
  }
}
