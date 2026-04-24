import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';

export async function verifyJwt(request: FastifyRequest, reply: FastifyReply) {
  try {
    // O Fastify pega automaticamente o token do cabeçalho Authorization: Bearer <token>
    // Se o token for válido e não estiver expirado, ele extrai os dados para request.user
    await request.jwtVerify();
  } catch (error) {
    throw new AppError('Não autorizado. Token ausente, expirado ou inválido.', 401);
  }
}