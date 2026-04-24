import { prisma } from "../../../database/prisma.js";


export class CategoryService {
  async findAll() {
    // Traz apenas categorias ativas (remoção lógica)
    return prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' }
    });
  }

  async create(data: { name: string; slug: string; description?: string }) {
    return prisma.category.create({ data });
  }

  async update(id: string, data: any) {
    return prisma.category.update({ where: { id }, data });
  }

  async softDelete(id: string) {
    // 1. Regra de Negócio: Validar se há produtos vinculados
    const productsCount = await prisma.product.count({
      where: { categoryId: id, deletedAt: null }
    });

    if (productsCount > 0) {
      throw new Error('Não é possível remover a categoria. Existem produtos vinculados a ela.');
    }

    // 2. Remoção Lógica (Soft Delete)
    return prisma.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false }
    });
  }
}