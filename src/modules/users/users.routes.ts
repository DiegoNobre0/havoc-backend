import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod'; // Importa o Provider
import { UsersController } from './users.controller.js';
import { createUserBodySchema } from './users.schemas.js'; // Importa o Schema
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';

const usersController = new UsersController();

export async function usersRoutes(app: FastifyInstance) { 
  app.addHook('onRequest', verifyJwt);

  app.withTypeProvider<ZodTypeProvider>().post('/', {
    schema: {
      tags: ['Usuários'],
      summary: 'Cria um novo usuário no sistema',      
      body: createUserBodySchema, 
      security: [{ bearerAuth: [] }], 
    }
  }, usersController.create);


  app.withTypeProvider<ZodTypeProvider>().get('/me', {
    onRequest: [verifyJwt], // <--- O Guardião protege a porta aqui
    schema: {
      tags: ['Usuários'],
      summary: 'Retorna os dados do usuário logado',
      security: [{ bearerAuth: [] }], 
    }
  }, usersController.me);
}