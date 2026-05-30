import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando o Seed Premium - Catálogo Definitivo (49 Produtos)...');

  // ==========================================
  // 1. LIMPEZA TOTAL DO BANCO
  // ==========================================
  console.log('🧹 Limpando dados antigos...');
  await prisma.orderStatusHistory.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.kitItem.deleteMany();
  await prisma.kit.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  // ==========================================
  // 2. CRIANDO AS CATEGORIAS E TAGS (N:N)
  // ==========================================
  console.log('📦 Construindo a árvore de categorias e filtros...');

  // Categorias Principais
  const catPreTreino = await prisma.category.create({
    data: { name: 'Pré-Treino', slug: 'pre-treino' },
  });
  const catCreatina = await prisma.category.create({
    data: { name: 'Creatina', slug: 'creatina' },
  });
  const catWhey = await prisma.category.create({
    data: { name: 'Whey Protein', slug: 'whey-protein' },
  });
  const catBeef = await prisma.category.create({
    data: { name: 'Proteína da Carne (Beef)', slug: 'proteina-carne' },
  });
  const catOvo = await prisma.category.create({
    data: { name: 'Albumina (Ovo)', slug: 'albumina-ovo' },
  });
  const catTermo = await prisma.category.create({
    data: { name: 'Termogênicos', slug: 'termogenicos' },
  });
  const catEmagrecimento = await prisma.category.create({
    data: { name: 'Emagrecimento & Definição', slug: 'emagrecimento-definicao' },
  });
  const catMaisVendidos = await prisma.category.create({
    data: { name: 'Mais Vendidos', slug: 'mais-vendidos' },
  });

  // Sub-categorias / Tags de Filtro
  const tagConcentrado = await prisma.category.create({
    data: { name: 'Whey Concentrado', slug: 'whey-concentrado' },
  });
  const tagIsolado = await prisma.category.create({
    data: { name: 'Whey Isolado', slug: 'whey-isolado' },
  });
  const tagHidrolisado = await prisma.category.create({
    data: { name: 'Whey Hidrolisado', slug: 'whey-hidrolisado' },
  });
  const tagZeroLactose = await prisma.category.create({
    data: { name: 'Zero Lactose', slug: 'zero-lactose' },
  });
  const tagSemGluten = await prisma.category.create({
    data: { name: 'Sem Glúten', slug: 'sem-gluten' },
  });
  const tagSemCafeina = await prisma.category.create({
    data: { name: 'Sem Cafeína (Stim Free)', slug: 'sem-cafeina' },
  });

  // ==========================================
  // 3. CADASTRANDO OS 49 PRODUTOS COM IMAGENS DO CLOUDFLARE
  // ==========================================
  console.log('💊 Cadastrando catálogo com múltiplas tags...');

  await Promise.all([
    // ---------------------------------------------------------
    // PRÉ-TREINOS
    // ---------------------------------------------------------
    prisma.product.create({
      data: {
        name: 'Max Titanium Hórus 300g - Amora',
        slug: 'max-titanium-horus-300g-amora',
        price: 109.9,
        stock: 100,
        description:
          'Pré-treino oficial dos campeões. Auxilia no aumento do estado de alerta com Beta-Alanina e Cafeína.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/13ccbff5-80d4-4f19-a6d3-55cf76189432.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'FTW Diabo Verde 300g - Bala de Framboesa',
        slug: 'ftw-diabo-verde-300g-framboesa',
        price: 119.9,
        stock: 100,
        description:
          'Fórmula ultra concentrada. Explosão de energia extrema para os treinos mais intensos.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/9b918d02-8f3b-4a06-b991-3a2e396f26a8.jpg',
        categories: { connect: [{ id: catPreTreino.id }, { id: catMaisVendidos.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Rampage 300g - Melancia com Limão',
        slug: 'under-labz-rampage-300g-melancia-limao',
        price: 169.9,
        stock: 100,
        description:
          'Matriz de energia agressiva para aumentar o pump, foco cognitivo e resistência muscular.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/1e7cadfa-198d-4078-9151-ef5786e4257c.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Fckng Booster 300g - Apple Beat',
        slug: 'under-labz-fckng-booster-300g-apple-beat',
        price: 179.9,
        stock: 100,
        description:
          'Booster extremo para atletas de alta performance. Energia contínua e foco inabalável.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/b52fa268-14fb-4603-a648-968a874b11fa.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Body Action Nuclear Rush 100g - Limão',
        slug: 'body-action-nuclear-rush-100g-limao',
        price: 79.9,
        stock: 100,
        description:
          'Pequeno no tamanho, brutal na fórmula! Boro, Citrulina, Taurina e impressionantes 400mg de Cafeína.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/fdc41011-fb72-4f41-b3b2-92ac9ddc88d7.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Health Cyde Psycho Bomb 300g - Red Fruits',
        slug: 'health-cyde-psycho-bomb-300g-red-fruits',
        price: 149.9,
        stock: 100,
        description: 'Fórmula explosiva projetada para maximizar energia, foco e vasodilatação.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/0cddf492-9421-4989-8e4d-094cbcdccc9c.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Rocket Energy 450g - Original',
        slug: 'under-labz-rocket-energy-450g',
        price: 199.9,
        stock: 100,
        description:
          'Energia de foguete para seus treinos. Enriquecido com Coenzima Q10, Citarg e Pump Matrix.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/9a5016d5-ea3d-4bc5-b14d-22e6753cc6ac.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Darkness Évora PW 300g - Limão',
        slug: 'darkness-evora-pw-300g-limao',
        price: 139.9,
        stock: 100,
        description:
          'Energia insana para treinos hardcore. Fornece força máxima e retarda a fadiga muscular.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/f24ad755-e00a-4d29-9ecf-983da36bc23a.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Warzone Nitric Oxide Precursor 300g - Green Bomb',
        slug: 'under-labz-warzone-nitric-oxide-300g-green-bomb',
        price: 189.9,
        stock: 100,
        description: 'Focado em Pump Matrix com altíssima dosagem de precursores de óxido nítrico.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/69afc863-6f89-41b3-a511-b919cbd46614.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'FTW Diabo Verde Pre-Workout (Nova Fórmula) 300g - Frutas Vermelhas',
        slug: 'ftw-diabo-verde-nova-formula-300g',
        price: 129.9,
        stock: 100,
        description:
          'A nova fórmula do clássico Diabo Verde, agora ainda mais potente e com absorção otimizada.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/dafe10cb-1743-40a7-bb96-3a28efb0c653.jpg',
        categories: { connect: [{ id: catPreTreino.id }] },
      },
    }),

    // ---------------------------------------------------------
    // CREATINAS
    // ---------------------------------------------------------
    prisma.product.create({
      data: {
        name: 'Black Skull Creatine Hardcore 150g - Sem Sabor',
        slug: 'black-skull-creatine-hardcore-150g',
        price: 69.9,
        stock: 100,
        description: 'Creatina monohidratada pura. Aumento comprovado de força e hipertrofia.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/0d02d975-1933-4098-b734-ea2caae58d1b.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Max Titanium Creatine 500g - Sem Sabor',
        slug: 'max-titanium-creatina-500g',
        price: 149.9,
        stock: 150,
        description: 'Pote econômico de meio quilo. 100% pura e com 0% sódio.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/3ab3d8b5-52fb-4f6d-ba1d-beea2a36f884.jpg',
        categories: {
          connect: [{ id: catCreatina.id }, { id: catMaisVendidos.id }, { id: tagSemGluten.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Creatine 100 Doses 300g - Sem Sabor',
        slug: 'under-labz-creatine-100-doses-300g',
        price: 119.9,
        stock: 100,
        description: '#BornToDisrupt. Creatina de altíssima pureza com rendimento para 100 doses.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/6edbd51d-56e8-4b25-8cbc-d2da3388c703.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Integralmedica Creatina Hardcore 300g - Sem Sabor',
        slug: 'integralmedica-creatina-hardcore-300g',
        price: 99.9,
        stock: 200,
        description:
          'O clássico indispensável. Recarrega os estoques de ATP para mais resistência.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/12c6f423-6b91-4bf9-99b6-93e775e15c9d.jpg',
        categories: {
          connect: [{ id: catCreatina.id }, { id: catMaisVendidos.id }, { id: tagSemGluten.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Darkness Creatine Pure Powder 300g - Sem Sabor',
        slug: 'darkness-creatine-pure-powder-300g',
        price: 129.9,
        stock: 100,
        description: 'Creatina premium monohidratada. Zero aditivos, zero glúten e zero açúcar.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/d554c445-db4b-4072-ba0a-5eba24e8b207.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Max Titanium Creatine 300g - Sem Sabor',
        slug: 'max-titanium-creatina-300g',
        price: 99.9,
        stock: 120,
        description: 'Pura e eficiente, a versão de 300g da marca líder do Brasil.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/78c11a68-f7f4-4118-b188-cdca0fa7d0ff.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Black Skull Creatine Hardcore 300g - Sem Sabor',
        slug: 'black-skull-creatine-hardcore-300g',
        price: 119.9,
        stock: 100,
        description: 'O dobro de rendimento da Caveira Preta. Aumento comprovado de força.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/316eaf79-c278-4560-b755-5ce9fb729862.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'FTW Diabo Verde Creatina 300g - Neutro',
        slug: 'ftw-diabo-verde-creatina-300g',
        price: 109.9,
        stock: 100,
        description: 'A força do Diabo Verde agora em creatina pura monohidratada.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/0446faa6-c997-458b-8881-6dd32cdc89ee.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'MK Suplementos Creatina Micronizada 300g - Sem Sabor',
        slug: 'mk-suplementos-creatina-micronizada-300g',
        price: 89.9,
        stock: 100,
        description: 'Creatina micronizada com absorção superior para máxima performance.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/86838407-cd9e-4fa6-95e8-fb6655666ed0.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Vitafor Creatine monohydrate 100% Pure 300g - Sem Sabor',
        slug: 'vitafor-creatine-pure-300g',
        price: 139.9,
        stock: 100,
        description: 'Padrão ouro de pureza Vitafor. Essencial para recarga de ATP.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/89598a8a-d59b-4817-8f88-213553d504f9.jpg',
        categories: { connect: [{ id: catCreatina.id }, { id: tagSemGluten.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'DUX Creatina 100% Pura 300g - Sem Sabor',
        slug: 'dux-creatina-100-pura-300g',
        price: 149.9,
        stock: 110,
        description: 'Creatina premium da DUX. Matéria-prima importada de eficácia comprovada.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e001e87b-14ef-4e49-ae35-dc41d88ac9c2.jpg',
        categories: {
          connect: [{ id: catCreatina.id }, { id: catMaisVendidos.id }, { id: tagSemGluten.id }],
        },
      },
    }),

    // ---------------------------------------------------------
    // WHEY PROTEIN & BLENDS
    // ---------------------------------------------------------
    prisma.product.create({
      data: {
        name: 'Olympus 3W Whey 900g - Leitinho',
        slug: 'olympus-3w-whey-900g-leitinho',
        price: 139.9,
        stock: 120,
        description: 'Blend inteligente de Whey Concentrado, Isolado e Hidrolisado.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/abda039d-6d93-4f20-9145-fc6b87919647.jpg',
        categories: {
          connect: [
            { id: catWhey.id },
            { id: tagConcentrado.id },
            { id: tagIsolado.id },
            { id: tagHidrolisado.id },
          ],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'MR Supplements Best Gourmet 900g - Pudim',
        slug: 'mr-supplements-best-gourmet-900g-pudim',
        price: 145.0,
        stock: 100,
        description: '100% Whey Protein com sabor idêntico a sobremesa de pudim.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/40a37c9d-1294-41dd-93fd-43f4209a9f74.jpg',
        categories: { connect: [{ id: catWhey.id }, { id: tagConcentrado.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Protein Crush 900g - Alpine Milk Bear',
        slug: 'under-labz-protein-crush-900g',
        price: 159.9,
        stock: 100,
        description: 'Alto valor biológico com Coenzima Q10. Sabor Leite Alpino sem glúten.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/d3341346-1414-463c-a2df-bda4c70af447.jpg',
        categories: {
          connect: [{ id: catWhey.id }, { id: tagConcentrado.id }, { id: tagSemGluten.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Max Titanium 100% Whey 900g - Morango',
        slug: 'max-titanium-100-whey-900g-morango',
        price: 119.9,
        stock: 140,
        description: 'Proteína concentrada clássica com alta quantidade de aminoácidos.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/ee8ea36b-c6d9-42eb-aae4-7d4998aa297f.jpg',
        categories: {
          connect: [{ id: catWhey.id }, { id: tagConcentrado.id }, { id: catMaisVendidos.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Integralmedica Whey 100% Pure 900g - Chocolate',
        slug: 'integralmedica-whey-100-pure-900g-chocolate',
        price: 119.9,
        stock: 150,
        description:
          'Whey Protein Concentrado com o clássico sabor de chocolate da Integralmedica.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/7e044993-32cd-4103-802e-4bfb88cc9e22.jpg',
        categories: {
          connect: [{ id: catWhey.id }, { id: tagConcentrado.id }, { id: catMaisVendidos.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz 100% Whey Crush 900g - Chocobear',
        slug: 'under-labz-100-whey-crush-900g-chocobear',
        price: 159.9,
        stock: 100,
        description: 'Sabor intenso de chocolate aliado a uma matriz proteica de alta absorção.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/53935d9b-2442-41c5-a9de-89de90d8a85d.jpg',
        categories: {
          connect: [{ id: catWhey.id }, { id: tagConcentrado.id }, { id: tagSemGluten.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Black Skull Whey 100% HD 900g - Morango',
        slug: 'black-skull-whey-100-hd-900g-morango',
        price: 129.9,
        stock: 100,
        description:
          'Whey Protein High Definition (3W). Matriz proteica pesada para quem treina de verdade.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/581294cf-a8e2-4ee8-aff7-0095d357629c.jpg',
        categories: {
          connect: [
            { id: catWhey.id },
            { id: tagConcentrado.id },
            { id: tagIsolado.id },
            { id: tagHidrolisado.id },
          ],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Vitafor Whey Protein WPC 900g - Mousse de Maracujá',
        slug: 'vitafor-whey-protein-wpc-900g-maracuja',
        price: 169.9,
        stock: 100,
        description:
          'Whey Protein Concentrado Premium com sabor refrescante de Mousse de Maracujá.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e99939f7-5290-4ab3-b9f7-81b2eb632bfb.jpg',
        categories: { connect: [{ id: catWhey.id }, { id: tagConcentrado.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'DUX Whey Protein Isolado 900g - Caramelo Salgado',
        slug: 'dux-whey-protein-isolado-900g-caramelo',
        price: 239.9,
        stock: 100,
        description: 'Proteína Isolada de altíssima pureza com sabor gourmet.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/7cfe7384-0966-40f9-a00e-c69ce2b6708e.jpg',
        categories: {
          connect: [{ id: catWhey.id }, { id: tagIsolado.id }, { id: tagZeroLactose.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Nutrata W100 Whey Concentrado 900g - Double Chocolate',
        slug: 'nutrata-w100-whey-concentrado-900g',
        price: 145.9,
        stock: 100,
        description: 'O melhor Whey Concentrado com o dobro de cacau.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/8d1537da-5de1-4062-b86b-09cdf54e57b1.jpg',
        categories: { connect: [{ id: catWhey.id }, { id: tagConcentrado.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Bluster Nutrition 100% Power Whey 900g - Baunilha',
        slug: 'bluster-nutrition-100-power-whey-900g',
        price: 99.9,
        stock: 100,
        description: 'Custo-benefício excelente para garantir sua cota diária de proteínas.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/45be7c14-48e3-4cee-9cf1-829fda0a5a4d.jpg',
        categories: { connect: [{ id: catWhey.id }, { id: tagConcentrado.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Body Action Isolate Prime Whey 900g - Baunilha Natural',
        slug: 'body-action-isolate-prime-whey-900g',
        price: 189.9,
        stock: 100,
        description: 'Isolado Premium com perfil de aminoácidos excelente para rápida recuperação.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/a623da8a-bd2f-4d71-99a0-1a34a5899a18.jpg',
        categories: {
          connect: [{ id: catWhey.id }, { id: tagIsolado.id }, { id: tagZeroLactose.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'DUX Whey Protein Concentrado 900g - Caramelo Salgado',
        slug: 'dux-whey-protein-concentrado-900g',
        price: 169.9,
        stock: 100,
        description: 'Sabor inconfundível de Caramelo Salgado na versão Concentrada.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/bd9ef724-c38e-45cd-a508-3e3a77c3f295.jpg',
        categories: { connect: [{ id: catWhey.id }, { id: tagConcentrado.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Body Action 100% Whey Prime 900g - Baunilha',
        slug: 'body-action-100-whey-prime-900g',
        price: 129.9,
        stock: 100,
        description: 'Combinação perfeita de proteínas para impulsionar seus resultados.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e21b58aa-ab71-49ed-93d4-57725414f164.jpg',
        categories: { connect: [{ id: catWhey.id }, { id: tagConcentrado.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Vitafor Whey Fort 3W 900g - Frutas Vermelhas',
        slug: 'vitafor-whey-fort-3w-900g',
        price: 179.9,
        stock: 100,
        description: 'Absorção em múltiplos estágios para nutrir os músculos por mais tempo.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/718daf7b-c1c2-4524-a5fc-959fa2de7333.jpg',
        categories: {
          connect: [
            { id: catWhey.id },
            { id: tagConcentrado.id },
            { id: tagIsolado.id },
            { id: tagHidrolisado.id },
          ],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Vitafor Isofort WPI 900g - Neutro',
        slug: 'vitafor-isofort-wpi-900g',
        price: 249.9,
        stock: 100,
        description:
          'Padrão clínico de Whey Protein Isolado. Alta pureza e rápida digestibilidade.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/be5f1f6c-2214-41a0-940a-8ef013181be5.jpg',
        categories: {
          connect: [
            { id: catWhey.id },
            { id: tagIsolado.id },
            { id: tagZeroLactose.id },
            { id: tagSemGluten.id },
          ],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Nutrata Iso Whey Clean 900g - Natural',
        slug: 'nutrata-iso-whey-clean-900g',
        price: 219.9,
        stock: 100,
        description: 'Proteína limpa, isolada e sem adoçantes artificiais.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e42f3362-28a9-4aef-856c-b493df44cd8c.jpg',
        categories: {
          connect: [
            { id: catWhey.id },
            { id: tagIsolado.id },
            { id: tagZeroLactose.id },
            { id: tagSemGluten.id },
          ],
        },
      },
    }),

    // ---------------------------------------------------------
    // PROTEÍNA DA CARNE (BEEF)
    // ---------------------------------------------------------
    prisma.product.create({
      data: {
        name: 'Darkness Carnibol 900g - Blueberry',
        slug: 'darkness-carnibol-900g-blueberry',
        price: 199.9,
        stock: 100,
        description:
          'Proteína da carne ultra-concentrada. O Carnibol é zero lactose e rico em aminoácidos essenciais.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/bb4e974d-b985-4421-b4e2-b97ee5033700.jpg',
        categories: { connect: [{ id: catBeef.id }, { id: tagZeroLactose.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Beef Protein Crush 900g - Morango & Kiwi',
        slug: 'under-labz-beef-protein-crush-900g',
        price: 209.9,
        stock: 100,
        description: 'Construção muscular com a proteína isolada da carne e um sabor refrescante.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/d96bb4df-765e-4959-b442-a28fceff31ac.jpg',
        categories: { connect: [{ id: catBeef.id }, { id: tagZeroLactose.id }] },
      },
    }),

    // ---------------------------------------------------------
    // ALBUMINA (OVO)
    // ---------------------------------------------------------
    prisma.product.create({
      data: {
        name: 'Uêvo Uêvolução da Proteína 420g - Explosão de Chocolate',
        slug: 'uevo-uevolucao-proteina-420g',
        price: 69.9,
        stock: 100,
        description:
          'A revolução da clara do ovo. Albumina premium de chocolate para nutrição prolongada.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/6755d15b-bfa9-41b2-b87e-33528c2997c6.jpg',
        categories: {
          connect: [{ id: catOvo.id }, { id: tagZeroLactose.id }, { id: tagSemGluten.id }],
        },
      },
    }),

    // ---------------------------------------------------------
    // TERMOGÊNICOS, EMAGRECIMENTO & ENERGIA
    // ---------------------------------------------------------
    prisma.product.create({
      data: {
        name: 'Health Cyde Trinka Abdômen Extreme Thermogenic 60 Caps',
        slug: 'health-cyde-trinka-abdomen-60-caps',
        price: 125.9,
        stock: 100,
        description: 'O dragão acordou! Termogênico extremo para derreter a gordura localizada.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/1d09780c-78ce-4225-a10b-5aacea800489.jpg',
        categories: { connect: [{ id: catTermo.id }, { id: catEmagrecimento.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Cafeína Anidra 200mg 60 Caps',
        slug: 'cafeina-anidra-200mg-60-caps',
        price: 49.9,
        stock: 150,
        description: 'Energia pura e rápida absorção. 200mg por cápsula para foco e desempenho.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/3feeabf1-2685-4310-aa7b-3c880ac632ac.jpg',
        categories: { connect: [{ id: catTermo.id }, { id: catEmagrecimento.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Body Action L-Carnitina 2000 480ml - Abacaxi com Hortelã',
        slug: 'body-action-l-carnitina-480ml',
        price: 89.9,
        stock: 100,
        description:
          'Transporta a gordura para ser queimada como energia. Enriquecida com Vitamina B5.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/6c452769-e142-4172-a501-63b39d41847a.jpg',
        categories: { connect: [{ id: catEmagrecimento.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Bull Pharma Skinni Bull Extreme Power 60 Caps',
        slug: 'bull-pharma-skinni-bull-60-caps',
        price: 139.9,
        stock: 100,
        description: 'Com Yohimbine HCL. Elevada queima de calorias, foco e humor aprimorados.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/6d1e0c68-3365-4a06-ba00-ed755e5c9ab9.jpg',
        categories: { connect: [{ id: catTermo.id }, { id: catEmagrecimento.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Dimethylex Thermogenic Stim Free (Azul) 60 Caps',
        slug: 'under-labz-dimethylex-stim-free-60-caps',
        price: 159.9,
        stock: 100,
        description:
          'Termogênico sem cafeína. Perfeito para queimar gordura sem afetar o seu sono.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/882b237f-4db8-464d-abad-03226f6ec664.jpg',
        categories: {
          connect: [{ id: catTermo.id }, { id: catEmagrecimento.id }, { id: tagSemCafeina.id }],
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Under Labz Dimethylex Thermogenic Fat Burner (Vermelho) 60 Caps',
        slug: 'under-labz-dimethylex-fat-burner-60-caps',
        price: 159.9,
        stock: 100,
        description: 'Queimador de gordura brutal com fórmula disruptiva para resultados extremos.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/4905cc59-e5dc-4873-a3fa-51a5f11e79a6.jpg',
        categories: { connect: [{ id: catTermo.id }, { id: catEmagrecimento.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Laboratory Lizard Yohimbine 5mg 90 Tablets',
        slug: 'lizard-yohimbine-5mg-90-tablets',
        price: 99.9,
        stock: 100,
        description:
          'Fat burner focado. A Ioimbina HCL atua diretamente nas reservas de gordura teimosa.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/7316cad8-8290-44de-98d7-e48702e8a3e2.jpg',
        categories: { connect: [{ id: catTermo.id }, { id: catEmagrecimento.id }] },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Diurax Potente Diurético 20 Comprimidos',
        slug: 'diurax-diuretico-20-comprimidos',
        price: 59.9,
        stock: 100,
        description:
          'Máxima definição muscular. Elimina a retenção de líquidos indesejada de forma rápida e segura.',
        imageUrl:
          'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/daa420fa-16b5-4f1c-981e-70f0283f15fb.jpg',
        categories: { connect: [{ id: catEmagrecimento.id }] },
      },
    }),
  ]);

  console.log(
    `✅ Seed finalizado! O seu banco de dados está agora populado com 49 produtos e filtros N:N avançados.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
