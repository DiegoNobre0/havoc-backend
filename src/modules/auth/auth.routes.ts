import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AuthController } from './auth.controller.js';
import { loginBodySchema, refreshTokenBodySchema } from './auth.schemas.js';

const authController = new AuthController();

export async function authRoutes(app: FastifyInstance) {
  // Rota de Login
  app.withTypeProvider<ZodTypeProvider>().post('/login', {
    schema: {
      tags: ['Autenticação'],
      summary: 'Realiza o login e retorna os tokens',
      body: loginBodySchema,
    },
  }, authController.login);

  // Rota de Refresh
  app.withTypeProvider<ZodTypeProvider>().post('/refresh', {
    schema: {
      tags: ['Autenticação'],
      summary: 'Renova a sessão do usuário enviando o Refresh Token',
      body: refreshTokenBodySchema,
    },
  }, authController.refresh);

  // Rota de Logout
  app.withTypeProvider<ZodTypeProvider>().post('/logout', {
    schema: {
      tags: ['Autenticação'],
      summary: 'Invalida o Refresh Token e desloga o usuário',
      body: refreshTokenBodySchema,
    },
  }, authController.logout);
}