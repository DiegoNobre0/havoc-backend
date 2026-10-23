import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD é obrigatória para executar o seed em produção.');
  }

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@havoc.com.br').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const passwordHash = await hash(password, 12);

  const existingAdmin = await prisma.user.findUnique({ where: { email } });

  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { isActive: true, deletedAt: null },
    });
    console.log(`Administrador local já existente e ativado: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      name: 'Administrador Havoc',
      email,
      password: passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log(`Administrador local criado: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('Senha local padrão: admin123');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
