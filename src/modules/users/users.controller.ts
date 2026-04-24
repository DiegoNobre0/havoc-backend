import { FastifyReply, FastifyRequest } from 'fastify';
import { UsersService } from './users.service.js';
import { CreateUserBody } from './users.schemas.js';

export class UsersController {
  // Tipamos o request com a interface do Zod
  async create(request: FastifyRequest<{ Body: CreateUserBody }>, reply: FastifyReply) {
    
    // O body já chega validado pela rota!
    const usersService = new UsersService();
    const user = await usersService.create(request.body); 

    return reply.status(201).send({
      message: 'Usuário criado com sucesso.',
      user,
    });
  }


  async me(request: FastifyRequest, reply: FastifyReply) {
    // O Fastify já extraiu o 'sub' (ID) do token JWT para nós
    const { sub } = request.user;

    const usersService = new UsersService();
    
    // Agora buscamos o perfil real e completo no banco de dados
    const userProfile = await usersService.getProfile(sub);

    return reply.status(200).send({
      user: userProfile,
    });
  }
}