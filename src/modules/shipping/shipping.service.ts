import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';

export class ShippingService {
  async listAll() {
    return prisma.shippingRule.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async create(data: any) {
    return prisma.shippingRule.create({ data });
  }

  async update(id: string, data: any) {
    const rule = await prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) throw new AppError('Regra de frete não encontrada.', 404);

    return prisma.shippingRule.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    const rule = await prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) throw new AppError('Regra de frete não encontrada.', 404);

    // Hard delete físico, pois regras de frete geralmente não quebram relatórios se deletadas
    return prisma.shippingRule.delete({ where: { id } });
  }
}