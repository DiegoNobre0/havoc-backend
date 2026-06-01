import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto'; // Nativo do Node para gerar IDs únicos
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { loginBodySchema } from './auth.schemas.js';
import { redis } from '../../shared/redis/redis.js';
import { AppError } from '../../shared/errors/AppError.js';

export class AuthController {
  async login(request: FastifyRequest, reply: FastifyReply) {
    // 1. Validação estrita
    const data = loginBodySchema.parse(request.body);

    // 2. Executa a regra de negócio
    const authService = new AuthService();
    const user = await authService.authenticate(data);

    // 3. Geração do Access Token (JWT curto - 15 min)
    const accessToken = await reply.jwtSign(
      {
        sub: user.id,
        role: user.role,
      }, // Payload adicional
      {
        sign: {
          sub: user.id, // Subject = ID do usuário
          expiresIn: '7d',
        },
      },
    );

    // 4. Geração do Refresh Token (Token longo e opaco - 7 dias)
    // Usamos UUID puro no lugar de um JWT para ter controle total de revogação no Redis
    const refreshToken = crypto.randomUUID();
    const TEMPO_7_DIAS_EM_SEGUNDOS = 60 * 60 * 24 * 7;

    // Salva no Redis com chave única (ex: "refresh_token:12345")
    await redis.set(
      `refresh_token:${refreshToken}`,
      user.id,
      'EX', // Configura tempo de expiração nativo do Redis
      TEMPO_7_DIAS_EM_SEGUNDOS,
    );

    // 5. Devolve o kit completo para o Frontend
    return reply.status(200).send({
      user,
      accessToken,
      refreshToken,
    });
  }

  // --- ROTA DE REFRESH TOKEN ---
  async refresh(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = request.body as { refreshToken: string };

    // 1. Busca no Redis O(1)
    const userId = await redis.get(`refresh_token:${refreshToken}`);

    if (!userId) {
      throw new AppError('Refresh token inválido, expirado ou já utilizado.', 401);
    }

    // 2. Busca o usuário no banco
    const authService = new AuthService();
    const user = await authService.getUserById(userId);

    // 3. Deleta o token antigo (Rotação de Token - Previne roubos)
    await redis.del(`refresh_token:${refreshToken}`);

    // 4. Gera NOVO Access Token (15 min)
    const newAccessToken = await reply.jwtSign(
      { sub: user.id, role: user.role },
      { sign: { expiresIn: '7d' } },
    );

    // 5. Gera NOVO Refresh Token (7 dias)
    const newRefreshToken = crypto.randomUUID();
    const TEMPO_7_DIAS_EM_SEGUNDOS = 60 * 60 * 24 * 7;

    await redis.set(`refresh_token:${newRefreshToken}`, user.id, 'EX', TEMPO_7_DIAS_EM_SEGUNDOS);

    return reply.status(200).send({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  }

  // --- ROTA DE LOGOUT ---
  async logout(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = request.body as { refreshToken: string };

    // Simplesmente vai no Redis e destrói o Token. O usuário está deslogado!
    await redis.del(`refresh_token:${refreshToken}`);

    return reply.status(200).send({
      message: 'Logout realizado com sucesso.',
    });
  }
}
