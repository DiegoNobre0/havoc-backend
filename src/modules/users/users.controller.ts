import { FastifyReply, FastifyRequest } from 'fastify';
import { UsersService } from './users.service.js';
import { CreateUserBody, UpdateUserBody, IdParam } from './users.schemas.js';

export class UsersController {
  async listAll(request: FastifyRequest, reply: FastifyReply) {
    const usersService = new UsersService();
    const users = await usersService.listAll();
    
    return reply.status(200).send(users);
  }

  async create(request: FastifyRequest<{ Body: CreateUserBody }>, reply: FastifyReply) {
    const usersService = new UsersService();
    const user = await usersService.create(request.body);

    return reply.status(201).send({
      message: 'Usuário criado com sucesso.',
      user,
    });
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const { sub } = request.user;
    const usersService = new UsersService();
    const userProfile = await usersService.getProfile(sub);

    return reply.status(200).send({
      user: userProfile,
    });
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: UpdateUserBody }>, reply: FastifyReply) {
    const usersService = new UsersService();
    const user = await usersService.update(request.params.id, request.body);

    return reply.status(200).send({
      message: 'Usuário atualizado com sucesso.',
      user,
    });
  }

  async softDelete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const usersService = new UsersService();
    await usersService.softDelete(request.params.id);

    return reply.status(204).send();
  }
}