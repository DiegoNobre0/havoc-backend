import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../logger.js';


export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: 'Erro de validação dos dados.',
      issues: error.format(),
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      status: 'error',
      message: error.message,
    });
  }

  // Log do erro interno que não foi tratado pela aplicação
  logger.error(error);

  return reply.status(500).send({
    status: 'error',
    message: 'Erro interno do servidor.',
  });
}