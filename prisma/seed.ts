import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Iniciando limpeza do catálogo...');

  // A ordem importa: apaga os produtos primeiro, depois as categorias
  const deletedProducts = await prisma.product.deleteMany();
  const deletedCategories = await prisma.category.deleteMany();

  console.log(`✅ Tudo limpo!`);
  console.log(`🗑️ ${deletedProducts.count} produtos apagados.`);
  console.log(`🗑️ ${deletedCategories.count} categorias apagadas.`);
}

main().finally(async () => {
  await prisma.$disconnect();
});
