import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UsersController } from './users.controller.js';
import { 
  createUserBodySchema, 
  updateUserBodySchema, 
  idParamSchema 
} from './users.schemas.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';

const usersController = new UsersController();

export async function usersRoutes(app: FastifyInstance) {
  // O Guardião protege TODAS as rotas deste arquivo
  app.addHook('onRequest', verifyJwt);

  app.withTypeProvider<ZodTypeProvider>().get('/', {
    schema: {
      tags: ['Usuários'],
      summary: 'Lista todos os usuários ativos do sistema',
      security: [{ bearerAuth: [] }],
    }
  }, usersController.listAll);

  app.withTypeProvider<ZodTypeProvider>().post('/', {
    schema: {
      tags: ['Usuários'],
      summary: 'Cria um novo usuário no sistema',
      body: createUserBodySchema,
      security: [{ bearerAuth: [] }],
    }
  }, usersController.create);

  app.withTypeProvider<ZodTypeProvider>().get('/me', {
    schema: {
      tags: ['Usuários'],
      summary: 'Retorna os dados do usuário logado',
      security: [{ bearerAuth: [] }],
    }
  }, usersController.me);

  app.withTypeProvider<ZodTypeProvider>().put('/:id', {
    schema: {
      tags: ['Usuários'],
      summary: 'Atualiza dados de um usuário',
      params: idParamSchema,
      body: updateUserBodySchema,
      security: [{ bearerAuth: [] }],
    }
  }, usersController.update);

  app.withTypeProvider<ZodTypeProvider>().delete('/:id', {
    schema: {
      tags: ['Usuários'],
      summary: 'Desativa um usuário do sistema (Soft Delete)',
      params: idParamSchema,
      security: [{ bearerAuth: [] }],
    }
  }, usersController.softDelete);
}