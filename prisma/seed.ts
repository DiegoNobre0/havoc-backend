import { PrismaClient, OrderStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Função auxiliar para gerar datas aleatórias no passado
function getRandomDate(daysBack: number) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
  return date;
}

async function main() {
  console.log('🌱 Iniciando o Seed da Havoc...');

  // 1. Limpar dados antigos (Na ordem certa para evitar erros de Foreign Key)
  console.log('🧹 Limpando o banco de dados...');
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  // Se tiver a tabela de Kits já criada, descomente as duas linhas abaixo:
  // await prisma.kitItem.deleteMany();
  // await prisma.kit.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  const hashedPassword = await bcrypt.hash('123456', 12);
  // 2. Criar Cliente Fictício
  const customer = await prisma.user.upsert({
    where: { email: 'cliente@teste.com' },
    update: {},
    create: {
      name: 'João Cliente VIP',
      email: 'cliente@teste.com',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  // 3. Criar Categorias
  console.log('📦 Criando Categorias...');
  const catProteina = await prisma.category.create({
    data: { name: 'Proteínas', slug: 'proteinas' }
  });
  const catEnergia = await prisma.category.create({
    data: { name: 'Energia & Foco', slug: 'energia-foco' }
  });
  const catMaisVendidos = await prisma.category.create({
    data: { name: 'Mais Vendidos', slug: 'mais-vendidos' } // 👈 Nova categoria extra!
  });

  // 4. Criar Produtos Reais da Havoc (Agora com N:N usando connect)
  console.log('📦 Criando Produtos e conectando múltiplas categorias...');
  const products = await Promise.all([
    prisma.product.create({
      data: { 
        name: 'Havoc Whey Isolado 1kg', 
        slug: 'havoc-whey-1kg', 
        price: 189.90, 
        stock: 150, 
        // 👇 Conectando a 2 categorias ao mesmo tempo!
        categories: { connect: [{ id: catProteina.id }, { id: catMaisVendidos.id }] } 
      }
    }),
    prisma.product.create({
      data: { 
        name: 'Creatina Monohidratada 300g', 
        slug: 'creatina-300g', 
        price: 99.90, 
        stock: 200, 
        categories: { connect: [{ id: catProteina.id }] } 
      }
    }),
    prisma.product.create({
      data: { 
        name: 'Nuclear Pre-Workout', 
        slug: 'nuclear-pre', 
        price: 149.90, 
        stock: 85, 
        categories: { connect: [{ id: catEnergia.id }, { id: catMaisVendidos.id }] } 
      }
    })
  ]);

  // 5. Gerar Pedidos Espalhados (Simulando Vendas Reais)
  console.log('💸 Simulando vendas dos últimos 30 dias...');
  const statuses: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'PENDING'];
  
  for (let i = 1; i <= 45; i++) {
    const numItems = Math.floor(Math.random() * 3) + 1;
    const orderProducts = products.sort(() => 0.5 - Math.random()).slice(0, numItems);
    
    let subtotal = 0;
    const itemsData = orderProducts.map(prod => {
      const quantity = Math.floor(Math.random() * 2) + 1;
      const unitPrice = Number(prod.price);
      const totalPrice = unitPrice * quantity;
      subtotal += totalPrice;
      
      return {
        productId: prod.id,
        quantity,
        unitPrice,
        totalPrice
      };
    });

    const shippingCost = 15.00;
    const total = subtotal + shippingCost;
    
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const orderDate = getRandomDate(30); 

    await prisma.order.create({
      data: {
        code: `HAV-${10000 + i}`,
        status: randomStatus,
        subtotal,
        shippingCost,
        total,
        userId: customer.id,
        createdAt: orderDate,
        items: {
          create: itemsData
        }
      }
    });
  }

  console.log('✅ Seed concluído com sucesso! Banco populado com N:N.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });