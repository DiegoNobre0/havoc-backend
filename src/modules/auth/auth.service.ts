import { compare } from 'bcryptjs';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import { LoginBody } from './auth.schemas.js';

export class AuthService {
  async authenticate({ email, password }: LoginBody) {
    // 1. Busca o usuário pelo e-mail
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Usamos a mesma mensagem genérica para não dar dicas a invasores
      throw new AppError('E-mail ou senha incorretos.', 401);
    }

    // 2. Compara a senha em texto limpo com o hash salvo no banco
    const isPasswordValid = await compare(password, user.password);

    if (!isPasswordValid) {
      throw new AppError('E-mail ou senha incorretos.', 401);
    }

    // 3. Remove a senha usando o operador rest que você já aprendeu
    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }



  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}