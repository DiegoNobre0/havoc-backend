import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'; // Importamos o FastifyError
import { AppError } from '../errors/AppError.js';

export function errorHandler(
  error: FastifyError | AppError | Error, // Tipamos explicitamente os tipos de erro possíveis
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      status: 'error',
      message: error.message,
    });
  }

  // Se o erro vier da própria validação do Zod (Fastify/Zod integration) ou outros plugins
  if ('statusCode' in error && error.statusCode) {
      return reply.status(error.statusCode).send({
          status: 'error',
          message: error.message,
      })
  }

  console.error(error);

  return reply.status(500).send({
    status: 'error',
    message: 'Internal server error',
  });
}