import { prisma } from "../../../database/prisma.js";


export class CategoryService {
  async findAll() {
    // Traz apenas categorias ativas (remoção lógica)
    return prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' }
    });
  }

  async create(data: any) {
    // 1. Verifica se já existe uma categoria com esse nome (mesmo que esteja deletada)
    const existingCategory = await prisma.category.findUnique({
      where: { name: data.name }
    });

    if (existingCategory) {
      throw new Error('Já existe uma categoria cadastrada com este nome.');
    }

    return prisma.category.create({ data });
  }

 async update(id: string, data: any) {
    // 1. Verifica se o usuário está tentando mudar para um nome que já existe
    if (data.name) {
      const existingCategory = await prisma.category.findUnique({
        where: { name: data.name }
      });

      // 2. Se achou uma categoria com esse nome E o ID dela for DIFERENTE da que estamos editando: bloqueia!
      if (existingCategory && existingCategory.id !== id) {
        throw new Error('Já existe outra categoria cadastrada com este nome.');
      }
    }

    return prisma.category.update({ where: { id }, data });
  }

 async softDelete(id: string) {
    // 1. Regra de Negócio: Validar se há produtos vinculados
    const productsCount = await prisma.product.count({
      where: { 
        deletedAt: null,       
        categories: { some: { id } } 
      }
    });

    if (productsCount > 0) {
      // É interessante disparar um erro HTTP 400 (Bad Request) em vez de 500
      throw new Error('Não é possível remover a categoria. Existem produtos vinculados a ela.');
    }

    // 2. Remoção Lógica (Soft Delete)
    return prisma.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false }
    });
  }
}