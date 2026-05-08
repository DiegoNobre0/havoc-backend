import { PrismaClient, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

function getRandomDate(daysBack: number) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
  return date;
}

async function main() {
  console.log('🌱 Iniciando o Seed Premium da Havoc Suplementos...');

  console.log('🧹 Limpando dados antigos...');
  await prisma.orderStatusHistory.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.kitItem.deleteMany();
  await prisma.kit.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  const existingUser = await prisma.user.findFirst();
  if (!existingUser) {
    console.error('❌ ERRO: Nenhum usuário encontrado. Crie um usuário no banco primeiro.');
    return;
  }

  console.log('📦 Criando categorias...');
  const cat = {
    prot: await prisma.category.create({ data: { name: 'Proteínas', slug: 'proteinas' } }),
    ener: await prisma.category.create({ data: { name: 'Energia & Foco', slug: 'energia-foco' } }),
    amino: await prisma.category.create({ data: { name: 'Aminoácidos', slug: 'aminoacidos' } }),
    emag: await prisma.category.create({ data: { name: 'Emagrecimento', slug: 'emagrecimento' } }),
    saude: await prisma.category.create({ data: { name: 'Saúde & Vitaminas', slug: 'saude' } }),
    massa: await prisma.category.create({ data: { name: 'Ganho de Massa', slug: 'ganho-de-massa' } }),
    vendas: await prisma.category.create({ data: { name: 'Mais Vendidos', slug: 'mais-vendidos' } }),
  };

  console.log('💊 Criando catálogo completo de produtos...');
  const products = await Promise.all([
    // ==========================================
    // PRODUTOS ORIGINAIS HAVOC (Índices 0 a 7)
    // ==========================================
    prisma.product.create({ 
      data: { 
        name: 'Havoc Elite - Whey Isolado 900g Chocolate Belga', slug: 'havoc-iso-choc', price: 229.90, stock: 50, 
        description: 'A linha Elite traz a pureza do soro do leite isolado com tecnologia de microfiltragem. 27g de proteína por dose e absorção ultra-rápida.',
        imageUrl: 'https://images.unsplash.com/photo-1593095191850-2a763399765a?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.prot.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Elite - Whey Isolado 900g Cookies', slug: 'havoc-iso-cookies', price: 229.90, stock: 40, 
        description: 'Sabor inigualável com pedaços reais de cookies. A proteína ideal para quem não abre mão do prazer e da dieta.',
        imageUrl: 'https://images.unsplash.com/photo-1546483875-ad9014c88eba?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Core - Whey Concentrado 1kg Baunilha', slug: 'havoc-conc-baunilha', price: 149.00, stock: 120, 
        description: 'Whey concentrado de alto valor biológico. Rico em BCAAs e perfeito para o aporte proteico diário em dietas de hipertrofia.',
        imageUrl: 'https://images.unsplash.com/photo-1579722820308-d74e5719d38e?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.prot.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Nuclear - Pré-Treino 300g Lemonade', slug: 'havoc-nuclear-lemon', price: 169.90, stock: 60, 
        description: 'Sinta o poder da explosão. Fórmula com Beta-Alanina e Arginina para o máximo pump e foco cognitivo durante o treino.',
        imageUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.ener.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Pure - Creatina Monohidratada 300g', slug: 'havoc-creatina-300', price: 119.90, stock: 300, 
        description: '100% pura e micronizada. Aumente sua força bruta e resistência muscular com a creatina de grau farmacêutico da Havoc.',
        imageUrl: 'https://images.unsplash.com/photo-1594498653385-d5172c532c00?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.amino.id }, { id: cat.massa.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Recovery - BCAA 2:1:1 120 Caps', slug: 'havoc-bcaa-caps', price: 69.90, stock: 150, 
        description: 'Recuperação muscular acelerada. Proteja seus músculos contra o catabolismo com o balanço perfeito de Leucina, Isoleucina e Valina.',
        imageUrl: 'https://images.unsplash.com/photo-1584017945391-5fe1f5c3d47a?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.amino.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Burn - Hellfire 60 Caps', slug: 'havoc-hellfire', price: 135.00, stock: 45, 
        description: 'O termogênico definitivo. Ataque a gordura localizada e aumente sua taxa metabólica basal com a tecnologia Hellfire.',
        imageUrl: 'https://images.unsplash.com/photo-1550572017-ed20bb0f4077?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.emag.id }, { id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Havoc Daily - Multivitamínico A-Z', slug: 'havoc-multivit', price: 75.00, stock: 200, 
        description: 'Saúde blindada. Suporte completo para sua imunidade e funções vitais com um blend de vitaminas e minerais de alta absorção.',
        imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?q=80&w=800&auto=format&fit=crop', 
        categories: { connect: [{ id: cat.saude.id }] } 
      } 
    }),

    // ==========================================
    // LOTE 1 (Índices 8 a 17)
    // ==========================================
    prisma.product.create({ 
      data: { 
        name: 'Integralmedica Whey 100% Pure 900g Cookies & Cream', slug: 'integralmedica-whey-100-cookies', price: 139.90, stock: 45, 
        description: 'Proteína concentrada de alto valor biológico para ganho de massa magra. Sabor irresistível de Cookies & Cream para facilitar sua dieta diária.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/c0a5f8d4-3d9c-4d8e-8b5a-1c9e8d7f6e5d.jpg', categories: { connect: [{ id: cat.prot.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Darkness Carnibol Beef Protein 900g Salted Caramel', slug: 'darkness-carnibol-caramel', price: 199.90, stock: 30, 
        description: 'Proteína isolada da carne de rápida absorção, ideal para intolerantes à lactose. Ganho extremo de força e hipertrofia com sabor premium.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/99be3311-d1d8-4322-846a-e1853ca667f6.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Uêvo Proteína Explosão de Chocolate 420g', slug: 'uevo-proteina-chocolate', price: 79.90, stock: 65, 
        description: 'A evolução da proteína com zero lactose e sabor irresistível de chocolate. Excelente perfil de aminoácidos para recuperação e síntese muscular.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/b70ff91b-ca37-4a16-9a4d-45f540a532e3.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Integralmedica Creamass Hipercalórico Morango', slug: 'integralmedica-creamass-morango', price: 89.90, stock: 60, 
        description: 'Combinação potente de carboidratos e proteínas para quem busca ganho de peso e volume muscular rápido. Energia de sobra para treinos intensos.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havocF/2ef2c29c-c691-43e0-9cb5-3dcdff4d5eb5.jpg', categories: { connect: [{ id: cat.massa.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Black Skull Creatina Micronizada 300g', slug: 'blackskull-creatina-mic-300', price: 109.90, stock: 120, 
        description: 'Creatina 100% pura e micronizada para máxima absorção. Aumente sua força explosiva, resistência e volume muscular em cada treino.',
        imageUrl: 'URL_DA_IMAGEM_AQUI', categories: { connect: [{ id: cat.amino.id }, { id: cat.massa.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Black Skull Creatine Hardcore 150g Sem Sabor', slug: 'blackskull-creatine-hardcore-150', price: 69.90, stock: 80, 
        description: 'A creatina monohidratada essencial para seu dia a dia. Melhora o desempenho físico em exercícios de alta intensidade e curta duração.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/18c85def-c4f7-449e-99f0-4714148b42ad.jpg', categories: { connect: [{ id: cat.amino.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Under Labz FCKNG Booster Pré-Treino 300g Maçã Verde', slug: 'underlabz-fckng-booster-maca', price: 159.90, stock: 40, 
        description: 'Pré-treino extremo para energia insana e foco absoluto. Fórmula ultra concentrada que vai elevar sua performance ao nível máximo.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/a4d5909d-60c4-47cd-a47d-64308e48fd95.jpg', categories: { connect: [{ id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Under Labz Warzone Pré-Treino Stim-Free 360g Passion & Fury', slug: 'underlabz-warzone-stim-free-passion', price: 169.90, stock: 35, 
        description: 'O pump máximo sem estimulantes (Zero Cafeína). Focado na vasodilatação extrema e entrega de nutrientes, perfeito para treinos noturnos.',
        imageUrl: 'URL_DA_IMAGEM_AQUI', categories: { connect: [{ id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Under Labz Warzone Pré-Treino Nitric Oxide 300g Green Bomb', slug: 'underlabz-warzone-nitric-greenbomb', price: 179.90, stock: 50, 
        description: 'Precursor de óxido nítrico para um pump absurdo e vascularização evidente. Energia explosiva e resistência incomparável para dominar o treino.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/15d2f47b-69ad-431f-a7be-a1c16428285c.jpg', categories: { connect: [{ id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'DiuraX Potente Diurético 20 Comprimidos', slug: 'diurax-diuretico-20-comp', price: 59.90, stock: 150, 
        description: 'Elimine a retenção de líquidos e alcance a máxima definição muscular. Fórmula avançada com matéria-prima importada para secar com saúde.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/0786bc7b-42c2-4300-a4da-818981547df5.jpg', categories: { connect: [{ id: cat.emag.id }] } 
      } 
    }),

    // ==========================================
    // LOTE 2 (Índices 18 a 27)
    // ==========================================
    prisma.product.create({ 
      data: { 
        name: 'Black Skull Whey 100% HD 900g Baunilha', slug: 'blackskull-whey-hd-baunilha', price: 129.90, stock: 55, 
        description: 'Matriz 3W (Concentrada, Isolada e Hidrolisada) em um só produto. Auxilia na construção e definição muscular com um autêntico sabor de baunilha.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/6f23ccd8-1347-482d-b98b-8bb2d279fd6c.jpg', categories: { connect: [{ id: cat.prot.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Dux Nutrition Whey Protein Isolado 900g Sabor Neutro', slug: 'dux-whey-isolado-neutro', price: 249.90, stock: 30, 
        description: 'Pureza máxima com 100% de proteína isolada duplamente filtrada. Absorção ultra-rápida e zero adições, ideal para receitas ou consumo puro.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/2706a832-5c02-49e0-887b-fa4b5474f6bd.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action 100% Whey Prime 900g Baunilha', slug: 'bodyaction-whey-prime-baunilha', price: 99.90, stock: 80, 
        description: 'Excelente custo-benefício para sua dieta. Enriquecido com Glutamina e BCAA (Crea-ATP) para otimizar sua recuperação muscular diária.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/b70ff91b-ca37-4a16-9a4d-45f540a532e3.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action Nuclear Rush Pré-Treino 100g Uva', slug: 'bodyaction-nuclear-rush-uva', price: 69.90, stock: 100, 
        description: 'Explosão de energia com 400mg de cafeína, boro e citrulina. O empurrão concentrado que faltava para você bater seus recordes no treino.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/0631b4a1-4a3f-4cb2-b0a0-fb2f5c10ad19.jpg', categories: { connect: [{ id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'FTW Diabo Verde Pré-Treino 300g Frutas Vermelhas', slug: 'ftw-diabo-verde-frutas-vermelhas', price: 119.90, stock: 65, 
        description: 'Nova fórmula insana com Beta-Alanina, Taurina e Cafeína. O verdadeiro terror da fadiga muscular para treinos de altíssima intensidade.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/8f5db738-ca04-4dee-abe3-6a9b1369d191.jpg', categories: { connect: [{ id: cat.ener.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Health Cyde Psycho Bomb Pré-Treino 300g Green Apple', slug: 'healthcyde-psycho-bomb-maca', price: 149.90, stock: 40, 
        description: 'Eleve seu treinamento ao extremo com energia e foco inigualáveis. Sabor refrescante de maçã verde e formulação com matéria-prima importada.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/7f3c31de-1a8b-4082-8e00-99a682a196dd.jpg', categories: { connect: [{ id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Lizard Yohimbine 5mg 90 Tabletes', slug: 'lizard-yohimbine-5mg', price: 89.90, stock: 50, 
        description: 'Potente queimador de gordura. A Ioimbina age diretamente nas reservas de gordura localizada mais difíceis, acelerando a definição muscular.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/2b24106a-b72a-402a-a814-9007da02ccb0.jpg', categories: { connect: [{ id: cat.emag.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: "Nutrition'all Magnésio Dimalato 60 Cápsulas", slug: 'nutritionall-magnesio-dimalato', price: 54.90, stock: 120, 
        description: 'Suporte vital para a saúde cardiovascular e redução da fadiga. Melhore sua energia celular e bem-estar geral com magnésio de alta absorção.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/2bc59f07-2594-4258-96a0-58b91152aa81.jpg', categories: { connect: [{ id: cat.saude.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action Magnésio & Inositol 210g Frutas Vermelhas', slug: 'bodyaction-magnesio-inositol-frutas', price: 79.90, stock: 45, 
        description: 'O combo perfeito para o relaxamento. Contém Taurina e Melatonina para garantir um sono profundo e restaurador após dias de treinos pesados.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/4801b926-14a5-41a7-8297-67c8b9968423.jpg', categories: { connect: [{ id: cat.saude.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action Complexo B de Vitaminas 60 Cápsulas Softgel', slug: 'bodyaction-complexo-b', price: 39.90, stock: 90, 
        description: 'Todas as vitaminas do complexo B (B1 a B12) em cápsulas softgel com TCM. Essencial para otimizar o metabolismo energético e a imunidade.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/9375f8be-5218-41ac-b002-186072314c4d.jpg', categories: { connect: [{ id: cat.saude.id }] } 
      } 
    }),

    // ==========================================
    // LOTE 3 (Índices 28 a 35)
    // ==========================================
    prisma.product.create({ 
      data: { 
        name: 'Black Skull Whey 100% HD 900g Morango', slug: 'blackskull-whey-hd-morango', price: 129.90, stock: 50, 
        description: 'A clássica matriz 3W Caveira Preta agora no sabor morango. Hipertrofia e recuperação com um blend perfeito de proteínas concentrada, isolada e hidrolisada.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/99be3311-d1d8-4322-846a-e1853ca667f6.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Nutrata W100 Whey Concentrado 900g Chocolate com Coco', slug: 'nutrata-w100-chocolate-coco', price: 119.90, stock: 60, 
        description: 'Sabor premium incrível de chocolate com coco. Whey 100% concentrado com alto índice de pureza e excelente digestibilidade para o seu dia a dia.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/5e5109b5-7686-41c5-9af5-716f8eab2eaa.jpg', categories: { connect: [{ id: cat.prot.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action 100% Whey Prime 900g Morango', slug: 'bodyaction-whey-prime-morango', price: 99.90, stock: 75, 
        description: 'Fórmula Low Carb rica em Glutamina e BCAA. O Whey Prime é seu aliado diário para manutenção da massa magra com um delicioso sabor de morango.',
        imageUrl: 'URL_DA_IMAGEM_AQUI', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action Isolate Prime Whey 900g Baunilha Natural', slug: 'bodyaction-isolate-prime-baunilha', price: 169.90, stock: 35, 
        description: 'Proteína Isolada e Hidrolisada, Zero Lactose. Enriquecida com CoQ10 e vitaminas, entrega a forma mais pura de nutrição muscular com rápida absorção.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/8b698c1f-ee3f-4a46-8ebe-5aa7ef0d76ea.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Vitafor Isofort WPI 900g Frutas Vermelhas', slug: 'vitafor-isofort-frutas-vermelhas', price: 229.90, stock: 25, 
        description: 'Referência em qualidade médica e nutricional. Whey Protein Isolate (WPI) Premium com 92% de proteína por dose, auxiliando na formação de músculos e ossos.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/8d91b7aa-66a2-4573-b1b1-d65ca4a5aa97.jpg', categories: { connect: [{ id: cat.prot.id }, { id: cat.vendas.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Nutrata Iso Whey 900g Creme de Baunilha', slug: 'nutrata-isowhey-creme-baunilha', price: 199.90, stock: 40, 
        description: 'Extraído por CFM (Cross-Flow Microfiltration), garantindo 100% de pureza e integridade das proteínas. Zero gorduras e carboidratos com sabor suave de baunilha.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/b70ff91b-ca37-4a16-9a4d-45f540a532e3.jpg', categories: { connect: [{ id: cat.prot.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Body Action Nuclear Rush Pré-Treino 100g Abacaxi', slug: 'bodyaction-nuclear-rush-abacaxi', price: 69.90, stock: 85, 
        description: 'Sabor refrescante de abacaxi com a mesma pegada nuclear! 400mg de cafeína, beta-alanina e taurina para treinos de altíssima performance.',
        imageUrl: 'URL_DA_IMAGEM_AQUI', categories: { connect: [{ id: cat.ener.id }] } 
      } 
    }),
    prisma.product.create({ 
      data: { 
        name: 'Bull Pharma Skinni Bull Extreme Power 60 Cápsulas', slug: 'bullpharma-skinni-bull', price: 99.90, stock: 40, 
        description: 'Termogênico insano com Yohimbine HCL. Queima calórica elevada, melhora extrema de foco e energia absurda para derreter gordura.',
        imageUrl: 'https://pub-2aabf6ca7b174b238f24715f461a0132.r2.dev/havoc/b0f2480f-5a9d-48fd-a877-1da88bfa51c8.jpg', categories: { connect: [{ id: cat.emag.id }] } 
      } 
    })
  ]);

  console.log('🎁 Criando Kits com descontos estratégicos...');
  
  const createKit = async (name: string, slug: string, desc: string, prodIndexes: number[], discountPerc: number, photoUrl: string) => {
    const selectedProds = prodIndexes.map(i => products[i]);
    const originalPrice = selectedProds.reduce((sum, p) => sum + Number(p.price), 0);
    const finalPrice = originalPrice * (1 - discountPerc / 100);

    return prisma.kit.create({
      data: {
        name, slug, description: desc,
        discountType: 'PERCENTAGE',
        discountValue: discountPerc,
        finalPrice,
        imageUrl: photoUrl,
        items: {
          create: selectedProds.map(p => ({ productId: p.id, quantity: 1 }))
        }
      }
    });
  };

  // Kits Originais
  await createKit(
    'Havoc Pack - Força Bruta', 'pack-forca-bruta', 
    'O combo definitivo para esmagar seus treinos: Whey Elite + Creatina Pure + Pré-Treino Nuclear.', 
    [0, 4, 3], 15, 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1000&auto=format&fit=crop'
  );

  await createKit(
    'Havoc Pack - Projeto Verão', 'pack-projeto-verao', 
    'Definição e queima calórica intensa. O suporte que você precisa para secar com saúde.', 
    [6, 0, 7], 12, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?q=80&w=1000&auto=format&fit=crop'
  );

  // Novos Kits com os Lotes 1, 2 e 3
  await createKit(
    'Combo Seca Tudo (Definição Extrema)', 'combo-seca-tudo', 
    'A tríade da definição: Termogênico Skinni Bull para queimar, Diurético DiuraX para desinchar e Yohimbine para gordura localizada.', 
    [35, 17, 24], 20, 'https://images.unsplash.com/photo-1605296867304-46d5465a13f1?q=80&w=1000&auto=format&fit=crop'
  );

  await createKit(
    'Combo Hipertrofia Monster', 'combo-hipertrofia-monster', 
    'Ganhe volume de verdade. Hipercalórico Creamass com Creatina Micronizada Black Skull e Whey 100% HD.', 
    [11, 12, 18], 15, 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?q=80&w=1000&auto=format&fit=crop'
  );

  await createKit(
    'Combo Performance & Pump', 'combo-performance-pump', 
    'Treinos insanos exigem o melhor. Pré-Treino Diabo Verde, Creatina Havoc Pure e o pré-treino sem cafeína Warzone para vascularização.', 
    [22, 4, 15], 10, 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=1000&auto=format&fit=crop'
  );

  await createKit(
    'Combo Saúde, Sono e Imunidade', 'combo-saude-sono-imunidade', 
    'Recuperação total pós-treino. Magnésio & Inositol para dormir bem, Complexo B para energia celular e Multivitamínico completo.', 
    [26, 27, 7], 18, 'https://images.unsplash.com/photo-1505576399279-565b52d4ac71?q=80&w=1000&auto=format&fit=crop'
  );

  await createKit(
    'Pack Isolado Premium (Zero Lactose)', 'pack-isolado-premium', 
    'Apenas a mais alta pureza. Dux Whey Isolado e Vitafor Isofort para uma absorção sem igual no seu pós-treino.', 
    [19, 32], 12, 'https://images.unsplash.com/photo-1579722820308-d74e5719d38e?q=80&w=1000&auto=format&fit=crop'
  );

  console.log('💸 Gerando histórico de vendas e pedidos...');
  const statuses: OrderStatus[] = ['DELIVERED', 'SHIPPED', 'PROCESSING', 'CONFIRMED', 'PENDING'];
  
  for (let i = 1; i <= 35; i++) {
    const numItems = Math.floor(Math.random() * 2) + 1;
    const shuffled = [...products].sort(() => 0.5 - Math.random()).slice(0, numItems);

    let subtotal = 0;
    const itemsData = shuffled.map(p => {
      const q = Math.floor(Math.random() * 2) + 1;
      const price = Number(p.price);
      subtotal += price * q;
      return { productId: p.id, quantity: q, unitPrice: price, totalPrice: price * q };
    });

    await prisma.order.create({
      data: {
        code: `HAV-${40000 + i}`,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        subtotal, shippingCost: 15.90, total: subtotal + 15.90,
        userId: existingUser.id,
        createdAt: getRandomDate(30),
        items: { create: itemsData }
      }
    });
  }

  console.log('✅ Tudo pronto! Banco de dados populado com sucesso com todo o catálogo da Havoc e novos kits.');
}

main()
  .catch(e => { 
    console.error(e); 
    process.exit(1); 
  })
  .finally(async () => { 
    await prisma.$disconnect(); 
  });