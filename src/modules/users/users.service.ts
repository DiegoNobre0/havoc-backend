import { hash } from 'bcryptjs';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import { CreateUserBody } from './users.schemas.js'; // 1. Importamos a tipagem do nosso schema

export class UsersService {
  // 2. Trocamos o Prisma.UserCreateInput pelo CreateUserBody
  async create({ name, email, password, role }: CreateUserBody) {
    
    const userExists = await prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      throw new AppError('Este e-mail já está em uso.', 409);
    }

    const hashedPassword = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        // 3. Agora o TypeScript sabe que 'role' é garantido (nunca undefined)
        role, 
      },
    });

    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }

  // Adicione este método dentro da classe UsersService:
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    // Usamos o nosso velho amigo operador rest para jogar a senha fora
    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }
}


