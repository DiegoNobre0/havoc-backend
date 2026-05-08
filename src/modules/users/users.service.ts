import { hash } from 'bcryptjs';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import { CreateUserBody, UpdateUserBody } from './users.schemas.js';

export class UsersService {
  async listAll() {
    return prisma.user.findMany({
      where: { deletedAt: null }, // Oculta deletados
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' }
    });
  }

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
        role,
      },
    });

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async update(id: string, data: UpdateUserBody) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    if (data.email && data.email !== user.email) {
      const emailExists = await prisma.user.findUnique({ where: { email: data.email } });
      if (emailExists) throw new AppError('Este e-mail já está em uso.', 409);
    }

    const updateData: any = { ...data };

    if (data.password) {
      updateData.password = await hash(data.password, 12);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    const { password: _, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async softDelete(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    await prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }
}