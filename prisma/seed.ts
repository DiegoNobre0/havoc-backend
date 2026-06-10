import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando o Super Seed Premium - Catálogo Unificado (76 Produtos)...');

  console.log('🧹 Limpando dados antigos para evitar conflitos de chaves...');
  await prisma.orderStatusHistory.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.kitItem.deleteMany();
  await prisma.kit.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  // ==========================================
  // 1. CRIANDO AS CATEGORIAS E TAGS (N:N)
  // ==========================================
  console.log('📦 Construindo a árvore completa de categorias...');

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

  // Novas Categorias estruturadas do novo lote
  const catSaudeVitaminas = await prisma.category.create({
    data: { name: 'Saúde & Vitaminas', slug: 'saude-vitaminas' },
  });
  const catFitoHormonal = await prisma.category.create({
    data: { name: 'Fitoterápicos & Hormonais', slug: 'fito-hormonais' },
  });
  const catOmegas = await prisma.category.create({
    data: { name: 'Ômega 3 & Óleos', slug: 'omega-3-oleos' },
  });
  const catAminoacidos = await prisma.category.create({
    data: { name: 'Aminoácidos Isolados', slug: 'aminoacidos-isolados' },
  });
  const catAlimentos = await prisma.category.create({
    data: { name: 'Alimentos Saudáveis', slug: 'alimentos-saudaveis' },
  });

  // Sub-categorias / Tags de Filtro Avançado
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
  // 2. CADASTRO DE PRODUTOS
  // ==========================================
  console.log('💊 Injetando 76 produtos com descrições e Modo de Uso...');

  const productsData = [
    // ---------------------------------------------------------
    // PRÉ-TREINOS ORIGINAIS + NOVOS
    // ---------------------------------------------------------
    {
      name: 'Max Titanium Hórus 300g - Amora',
      slug: 'max-titanium-horus-300g-amora',
      price: 109.9,
      stock: 100,
      description:
        'Pré-treino oficial dos campeões. Auxilia no aumento do estado de alerta e foco intenso com alta concentração de Beta-Alanina, Arginina e Cafeína.\n\nModo de Uso: Diluir 8.4g (1 dosador) em 300ml de água gelada e consumir em pequenas doses de 40ml a cada 2 horas ou 30-45 minutos antes do treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/13ccbff5-80d4-4f19-a6d3-55cf76189432.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'FTW Diabo Verde 300g - Bala de Framboesa',
      slug: 'ftw-diabo-verde-300g-framboesa',
      price: 119.9,
      stock: 100,
      description:
        'Fórmula ultra concentrada termogênica. Explosão de energia, foco cognitivo e resistência extrema para os treinos insanos.\n\nModo de Uso: Dissolver 1 dosador (10g) em 200ml de água, consumir preferencialmente 30 minutos antes da atividade física.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/9b918d02-8f3b-4a06-b991-3a2e396f26a8.jpg',
      catIds: [catPreTreino.id, catMaisVendidos.id],
    },
    {
      name: 'Under Labz Rampage 300g - Melancia com Limão',
      slug: 'under-labz-rampage-300g-melancia-limao',
      price: 169.9,
      stock: 100,
      description:
        'Matriz Primal de alta octanagem. Desenvolvido para atletas hardcore que buscam pump muscular extremo, vascularização máxima e energia limpa.\n\nModo de Uso: Misturar 1 scoop (10g) em 250ml de água fria. Tomar de 20 a 30 minutos antes do início do treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/1e7cadfa-198d-4078-9151-ef5786e4257c.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'Under Labz Fckng Booster 300g - Apple Beat',
      slug: 'under-labz-fckng-booster-300g-apple-beat',
      price: 179.9,
      stock: 100,
      description:
        'Matriz energética Ecstasy Energy de liberação prolongada. Reduz drasticamente a fadiga central e periférica.\n\nModo de Uso: Tomar 1 porção de 10g diluída em 200ml de água gelada antes dos treinos ou conforme orientação profissional.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/b52fa268-14fb-4603-a648-968a874b11fa.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'Body Action Nuclear Rush 100g - Limão',
      slug: 'body-action-nuclear-rush-100g-limao',
      price: 79.9,
      stock: 100,
      description:
        'Pequeno no tamanho, monumental na fórmula! Concentrado com Boro, Citrulina, Taurina e potentes 400mg de Cafeína por dose.\n\nModo de Uso: Misturar 1 dosador raso (2,5g) em 150ml de água gelada. Ingerir em doses fracionadas antes do exercício físico.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/fdc41011-fb72-4f41-b3b2-92ac9ddc88d7.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'Health Cyde Psycho Bomb 300g - Red Fruits',
      slug: 'health-cyde-psycho-bomb-300g-red-fruits',
      price: 149.9,
      stock: 100,
      description:
        'Fórmula sinérgica explosiva focada em foco mental apurado, vasodilatação periférica e potência muscular brutal.\n\nModo de Uso: Consumir 1 porção de 10g misturada em 300ml de água fria 30 minutos antes do treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/0cddf492-9421-4989-8e4d-094cbcdccc9c.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'Under Labz Rocket Energy 450g - Original',
      slug: 'under-labz-rocket-energy-450g',
      price: 199.9,
      stock: 100,
      description:
        'Matriz energética limpa de alto rendimento. Com Coenzima Q10 e Citarg para otimização da respiração celular e mitigação de cãibras.\n\nModo de Uso: Diluir 15g (1 scoop e meio) em 300ml de água gelada. Consumir antes ou durante treinos de longa duração.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/9a5016d5-ea3d-4bc5-b14d-22e6753cc6ac.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'Darkness Évora PW 300g - Limão',
      slug: 'darkness-evora-pw-300g-limao',
      price: 139.9,
      stock: 100,
      description:
        'Pré-treino da linha hardcore Darkness. Desenvolvido para maximizar o rendimento físico geral sob condições extremas de estresse muscular.\n\nModo de Uso: Diluir 1 dosador (5g) em 200ml de água gelada. Consumir meia hora antes de iniciar as séries.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/f24ad755-e00a-4d29-9ecf-983da36bc23a.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'Under Labz Warzone Nitric Oxide Precursor 300g - Green Bomb',
      slug: 'under-labz-warzone-nitric-oxide-300g-green-bomb',
      price: 189.9,
      stock: 100,
      description:
        'Precursor avançado de Óxido Nítrico. Focado na otimização do fluxo sanguíneo, transporte hipertrófico de nutrientes e oxigenação muscular.\n\nModo de Uso: Dissolver 10g (1 dosador) em 250ml de água gelada e tomar de 30 a 40 minutos antes da atividade.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/69afc863-6f89-41b3-a511-b919cbd46614.jpg',
      catIds: [catPreTreino.id],
    },
    {
      name: 'FTW Diabo Verde Pre-Workout (Nova Fórmula) 300g - Frutas Vermelhas',
      slug: 'ftw-diabo-verde-nova-formula-300g',
      price: 129.9,
      stock: 100,
      description:
        'Evolução tecnológica do Diabo Verde. Absorção celular acelerada e balanço eletrolítico otimizado para evitar fadiga precoce.\n\nModo de Uso: Misturar 10g (1 colher dosadora) em 200ml de água gelada e consumir 30 minutos antes do exercício físico.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/dafe10cb-1743-40a7-bb96-3a28efb0c653.jpg',
      catIds: [catPreTreino.id],
    },

    // ---------------------------------------------------------
    // CREATINAS
    // ---------------------------------------------------------
    {
      name: 'Black Skull Creatine Hardcore 150g - Sem Sabor',
      slug: 'black-skull-creatine-hardcore-150g',
      price: 69.9,
      stock: 100,
      description:
        'Creatina monohidratada ultra pura da linha Caveira Preta. Auxilia na hidratação celular e ressíntese rápida de ATP.\n\nModo de Uso: Misturar 1 colher de café (3g) em 150ml de água ou em sua bebida carboidratada preferida uma vez ao dia, todos os dias.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/0d02d975-1933-4098-b734-ea2caae58d1b.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'Max Titanium Creatine 500g - Sem Sabor',
      slug: 'max-titanium-creatina-500g',
      price: 149.9,
      stock: 150,
      description:
        'Pote econômico de meio quilo. Matéria-prima importada micronizada de alta solubilidade e pureza absoluta, sem sódio adicionado.\n\nModo de Uso: Diluir 3g (1 dosador) em 200ml de água ou suco. Consumir diariamente, inclusive em dias de descanso.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/3ab3d8b5-52fb-4f6d-ba1d-beea2a36f884.jpg',
      catIds: [catCreatina.id, catMaisVendidos.id, tagSemGluten.id],
    },
    {
      name: 'Under Labz Creatine 100 Doses 300g - Sem Sabor',
      slug: 'under-labz-creatine-100-doses-300g',
      price: 119.9,
      stock: 100,
      description:
        'Creatina Monohidratada importada com rendimento industrial focado em volumização muscular e regeneração de tecidos pós-treino.\n\nModo de Uso: Tomar uma porção de 3g diluída em água ou shake pós-treino de forma contínua.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/6edbd51d-56e8-4b25-8cbc-d2da3388c703.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'Integralmedica Creatina Hardcore 300g - Sem Sabor',
      slug: 'integralmedica-creatina-hardcore-300g',
      price: 99.9,
      stock: 200,
      description:
        'O suplemento número 1 do mundo para ganho de força e explosão. Creatina pura sem aditivos químicos ou conservantes.\n\nModo de Uso: Consumir 3g (1 dosador) diluídos em água ou bebida de sua escolha de forma crono-dependente todos os dias.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/12c6f423-6b91-4bf9-99b6-93e775e15c9d.jpg',
      catIds: [catCreatina.id, catMaisVendidos.id, tagSemGluten.id],
    },
    {
      name: 'Darkness Creatine Pure Powder 300g - Sem Sabor',
      slug: 'darkness-creatine-pure-powder-300g',
      price: 129.9,
      stock: 100,
      description:
        'Creatina monohidratada de grau farmacêutico da linha Darkness. Potencializa o ganho de massa magra bruta.\n\nModo de Uso: Diluir 3g (1 dosador) em 150ml de água. Consumir uma vez ao dia, preferencialmente com um carboidrato de alto índice glicêmico.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/d554c445-db4b-4072-ba0a-5eba24e8b207.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'Max Titanium Creatine 300g - Sem Sabor',
      slug: 'max-titanium-creatina-300g',
      price: 99.9,
      stock: 120,
      description:
        'A versão ideal de 300g da creatina mais vendida do Brasil. Otimiza os treinos de alta intensidade e curta duração.\n\nModo de Uso: Dissolver 3g do produto em copo com água ou shake proteico, misturando até homogeneizar.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/78c11a68-f7f4-4118-b188-cdca0fa7d0ff.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'Black Skull Creatine Hardcore 300g - Sem Sabor',
      slug: 'black-skull-creatine-hardcore-300g',
      price: 119.9,
      stock: 100,
      description:
        'Rendimento estendido da Creatina Hardcore da Black Skull. Ideal para ciclos longos de hipertrofia muscular.\n\nModo de Uso: Ingerir 3g diluídos em 150ml de água uma vez ao dia, preferencialmente após o treino ou conforme recomendação nutricional.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/316eaf79-c278-4560-b755-5ce9fb729862.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'FTW Diabo Verde Creatina 300g - Neutro',
      slug: 'ftw-diabo-verde-creatina-300g',
      price: 109.9,
      stock: 100,
      description:
        'Potência brutal na linha Diabo Verde. Pureza laboratorial máxima para acelerar a regeneração celular.\n\nModo de Uso: Diluir 3g em 200ml de água de forma contínua para manter a saturação muscular.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/0446faa6-c997-458b-8881-6dd32cdc89ee.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'MK Suplementos Creatina Micronizada 300g - Sem Sabor',
      slug: 'mk-suplementos-creatina-micronizada-300g',
      price: 89.9,
      stock: 100,
      description:
        'Creatina com partículas reduzidas para dissolução e digestibilidade instantâneas, evitando desconforto gástrico.\n\nModo de Uso: Ingerir 1 porção diária de 3g diluída em líquido de sua escolha.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/86838407-cd9e-4fa6-95e8-fb6655666ed0.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'Vitafor Creatine monohydrate 100% Pure 300g - Sem Sabor',
      slug: 'vitafor-creatine-pure-300g',
      price: 139.9,
      stock: 100,
      description:
        'Creatina com qualidade clínica da Vitafor. Matéria-prima importada vegana de altíssima pureza internacional.\n\nModo de Uso: Dissolver 3g (1 colher medida) em água ou shake proteico, ingerindo de forma diária.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/89598a8a-d59b-4817-8f88-213553d504f9.jpg',
      catIds: [catCreatina.id, tagSemGluten.id],
    },
    {
      name: 'DUX Creatina 100% Pura 300g - Sem Sabor',
      slug: 'dux-creatina-100-pura-300g',
      price: 149.9,
      stock: 110,
      description:
        'Creatina monohidratada premium importada da DUX. Solubilidade perfeita e controle de qualidade extremo lote a lote.\n\nModo de Uso: Consumir 1 dose de 3g diluída em água gelada antes ou após os treinamentos físicos.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e001e87b-14ef-4e49-ae35-dc41d88ac9c2.jpg',
      catIds: [catCreatina.id, catMaisVendidos.id, tagSemGluten.id],
    },

    // ---------------------------------------------------------
    // WHEY PROTEIN & PROTEÍNAS
    // ---------------------------------------------------------
    {
      name: 'Olympus 3W Whey 900g - Leitinho',
      slug: 'olympus-3w-whey-900g-leitinho',
      price: 139.9,
      stock: 120,
      description:
        'Tríplice combinação proteica: Concentrada, Isolada e Hidrolisada. Rico em BCAAs com sabor gourmet de leite em pó.\n\nModo de Uso: Dissolver 2 dosadores (30g) em 200ml de água gelada ou leite desnatado pós-treino ou no café da manhã.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/abda039d-6d93-4f20-9145-fc6b87919647.jpg',
      catIds: [catWhey.id, tagConcentrado.id, tagIsolado.id, tagHidrolisado.id],
    },
    {
      name: 'MR Supplements Best Gourmet 900g - Pudim',
      slug: 'mr-supplements-best-gourmet-900g-pudim',
      price: 145.0,
      stock: 100,
      description:
        '100% Whey Protein Concentrado Gourmet. Alta cremosidade com sabor idêntico ao clássico pudim de leite.\n\nModo de Uso: Bater 30g do produto com 150ml de água ou leite gelado. Ideal para shakes proteicos e receitas fit.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/40a37c9d-1294-41dd-93fd-43f4209a9f74.jpg',
      catIds: [catWhey.id, tagConcentrado.id],
    },
    {
      name: 'Under Labz Protein Crush 900g - Alpine Milk Bear',
      slug: 'under-labz-protein-crush-900g',
      price: 159.9,
      stock: 100,
      description:
        'Proteína isolada e concentrada enriquecida com Coenzima Q10. Auxilia na recuperação e síntese miofibrilar.\n\nModo de Uso: Misturar 1 scoop (35g) em 200ml de água gelada e tomar após o treino ou entre as principais refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/d3341346-1414-463c-a2df-bda4c70af447.jpg',
      catIds: [catWhey.id, tagConcentrado.id, tagSemGluten.id],
    },
    {
      name: 'Max Titanium 100% Whey 900g - Morango',
      slug: 'max-titanium-100-whey-900g-morango',
      price: 119.9,
      stock: 140,
      description:
        'Proteína do soro do leite 100% concentrada. Alto valor biológico e excelente perfil de aminoácidos estruturais.\n\nModo de Uso: Adicionar 2 dosadores (30g) em 200ml de água gelada. Consumir logo após os treinos pesados.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/ee8ea36b-c6d9-42eb-aae4-7d4998aa297f.jpg',
      catIds: [catWhey.id, tagConcentrado.id, catMaisVendidos.id],
    },
    {
      name: 'Integralmedica Whey 100% Pure 900g - Chocolate',
      slug: 'integralmedica-whey-100-pure-900g-chocolate',
      price: 119.9,
      stock: 150,
      description:
        'Suplemento proteico clássico de Chocolate. Baixo teor de gorduras saturadas, perfeito para ganho muscular magro.\n\nModo de Uso: Misturar 30g em 200ml de água fria no liquidificador ou coqueteleira pós-treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/7e044993-32cd-4103-802e-4bfb88cc9e22.jpg',
      catIds: [catWhey.id, tagConcentrado.id, catMaisVendidos.id],
    },
    {
      name: 'Under Labz 100% Whey Crush 900g - Chocobear',
      slug: 'under-labz-100-whey-crush-900g-chocobear',
      price: 159.9,
      stock: 100,
      description:
        'Sabor intenso e gourmet de chocolate com pedaços. Combina alta taxa de absorção com saciedade prolongada.\n\nModo de Uso: Tomar 1 scoop (32g) batido com água fria pós-treino ou no lanche intermediário.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/53935d9b-2442-41c5-a9de-89de90d8a85d.jpg',
      catIds: [catWhey.id, tagConcentrado.id, tagSemGluten.id],
    },
    {
      name: 'Black Skull Whey 100% HD 900g - Morango',
      slug: 'black-skull-whey-100-hd-900g-morango',
      price: 129.9,
      stock: 85,
      description:
        'Whey Protein High Definition (3W). Matriz de proteínas filtradas com tecnologia SpiroFuse Reverse Osmosis.\n\nModo de Uso: Misturar 3 colheres de sopa (30g) em 150ml a 200ml de água uma vez ao dia.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/581294cf-a8e2-4ee8-aff7-0095d357629c.jpg',
      catIds: [catWhey.id, tagConcentrado.id, tagIsolado.id, tagHidrolisado.id],
    },
    {
      name: 'Vitafor Whey Protein WPC 900g - Mousse de Maracujá',
      slug: 'vitafor-whey-protein-wpc-900g-maracuja',
      price: 169.9,
      stock: 40,
      description:
        'Whey Concentrado de pureza estrutural rígida. Sabor tropical de maracujá, adoçado com edulcorantes naturais.\n\nModo de Uso: Dissolver 30g (2 colheres medida) em 200ml de água mineral gelada após a atividade física.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e99939f7-5290-4ab3-b9f7-81b2eb632bfb.jpg',
      catIds: [catWhey.id, tagConcentrado.id],
    },
    {
      name: 'DUX Whey Protein Isolado 900g - Caramelo Salgado',
      slug: 'dux-whey-protein-isolado-900g-caramelo',
      price: 239.9,
      stock: 65,
      description:
        'Isolado Premium de fluxo duplo. Praticamente zero gorduras e carboidratos, ideal para janelas metabólicas exigentes.\n\nModo de Uso: Misturar 1 dosador (31g) em 200ml de água fria. Consumir imediatamente pós-treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/7cfe7384-0966-40f9-a00e-c69ce2b6708e.jpg',
      catIds: [catWhey.id, tagIsolado.id, tagZeroLactose.id],
    },
    {
      name: 'Nutrata W100 Whey Concentrado 900g - Double Chocolate',
      slug: 'nutrata-w100-whey-concentrado-900g',
      price: 145.9,
      stock: 55,
      description:
        'Whey concentrado por processo de ultrafiltração (CFM). Sabor intenso com alta densidade de BCAAs naturais.\n\nModo de Uso: Diluir 30g (1 colher medida) em 200ml de água gelada 1 a 2 vezes ao dia.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/8d1537da-5de1-4062-b86b-09cdf54e57b1.jpg',
      catIds: [catWhey.id, tagConcentrado.id],
    },
    {
      name: 'Bluster Nutrition 100% Power Whey 900g - Baunilha',
      slug: 'bluster-nutrition-100-power-whey-900g',
      price: 99.9,
      stock: 30,
      description:
        'Suplemento proteico econômico de alto valor para dietas hipercalóricas ou de manutenção de tecidos musculares.\n\nModo de Uso: Bater 40g em 200ml de leite ou água no liquidificador após os treinos.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/45be7c14-48e3-4cee-9cf1-829fda0a5a4d.jpg',
      catIds: [catWhey.id, tagConcentrado.id],
    },
    {
      name: 'Body Action Isolate Prime Whey 900g - Baunilha Natural',
      slug: 'body-action-isolate-prime-whey-900g',
      price: 189.9,
      stock: 45,
      description:
        'Isolado e Hidrolisado de fluxo cruzado. Enriquecido com Coenzima Q10 para aceleração energética celular.\n\nModo de Uso: Dissolver 30g em 200ml de água gelada. Ideal para o pós-treino imediato.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/a623da8a-bd2f-4d71-99a0-1a34a5899a18.jpg',
      catIds: [catWhey.id, tagIsolado.id, tagZeroLactose.id],
    },
    {
      name: 'DUX Whey Protein Concentrado 900g - Caramelo Salgado',
      slug: 'dux-whey-protein-concentrado-900g',
      price: 169.9,
      stock: 95,
      description:
        'Fórmula limpa e pura com o marcante sabor de Caramelo Salgado da DUX. Construção limpa de tecidos.\n\nModo de Uso: Tomar 1 scoop (30g) diluído em 200ml de água ou em receitas fit.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/bd9ef724-c38e-45cd-a508-3e3a77c3f295.jpg',
      catIds: [catWhey.id, tagConcentrado.id],
    },
    {
      name: 'Body Action 100% Whey Prime 900g - Baunilha',
      slug: 'body-action-100-whey-prime-900g',
      price: 129.9,
      stock: 80,
      description:
        'Combinação precisa de proteínas do soro do leite para ganho estrutural magro sem picos glicêmicos.\n\nModo de Uso: Misturar 30g com 150ml de água fria na coqueteleira logo após o treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e21b58aa-ab71-49ed-93d4-57725414f164.jpg',
      catIds: [catWhey.id, tagConcentrado.id],
    },
    {
      name: 'Vitafor Whey Fort 3W 900g - Frutas Vermelhas',
      slug: 'vitafor-whey-fort-3w-900g',
      price: 179.9,
      stock: 50,
      description:
        'Sistema multifásico de proteínas WPC, WPI e WPH. Excelente digestibilidade com sabor de Frutas Vermelhas.\n\nModo de Uso: Dissolver 30g em 200ml de água ou suco de frutas pós-treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/718daf7b-c1c2-4524-a5fc-959fa2de7333.jpg',
      catIds: [catWhey.id, tagConcentrado.id, tagIsolado.id, tagHidrolisado.id],
    },
    {
      name: 'Vitafor Isofort WPI 900g - Neutro',
      slug: 'vitafor-isofort-wpi-900g',
      price: 249.9,
      stock: 25,
      description:
        'Whey Isolado Premium com 92% de proteína por dose. Livre de corantes, açúcares e aromatizantes.\n\nModo de Uso: Misturar 30g (2 colheres medida) em água, sucos ou misturado à sua refeição proteica.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/be5f1f6c-2214-41a0-940a-8ef013181be5.jpg',
      catIds: [catWhey.id, tagIsolado.id, tagZeroLactose.id, tagSemGluten.id],
    },
    {
      name: 'Nutrata Iso Whey Clean 900g - Natural',
      slug: 'nutrata-iso-whey-clean-900g',
      price: 219.9,
      stock: 35,
      description:
        'Proteína limpa purificada por CFM. Ideal para atletas intolerantes à lactose ou glúten.\n\nModo de Uso: Diluir 30g em 200ml de água gelada após o treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/e42f3362-28a9-4aef-856c-b493df44cd8c.jpg',
      catIds: [catWhey.id, tagIsolado.id, tagZeroLactose.id, tagSemGluten.id],
    },

    // ---------------------------------------------------------
    // PROTEÍNAS DA CARNE E OVO
    // ---------------------------------------------------------
    {
      name: 'Darkness Carnibol 900g - Blueberry',
      slug: 'darkness-carnibol-900g-blueberry',
      price: 199.9,
      stock: 35,
      description:
        'Proteína isolada e hidrolisada da carne bovina. Rico em creatina natural, livre de gorduras e lactose.\n\nModo de Uso: Diluir 1 dosador (35g) em 250ml de água logo após a sessão de treinos.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/bb4e974d-b985-4421-b4e2-b97ee5033700.jpg',
      catIds: [catBeef.id, tagZeroLactose.id],
    },
    {
      name: 'Under Labz Beef Protein Crush 900g - Morango & Kiwi',
      slug: 'under-labz-beef-protein-crush-900g',
      price: 209.9,
      stock: 30,
      description:
        'Proteína isolada da carne com delicioso sabor refrescante de frutas, ideal para dietas restritivas ao leite.\n\nModo de Uso: Misturar 1 scoop (35g) em 200ml de água bem gelada pós-treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/d96bb4df-765e-4959-b442-a28fceff31ac.jpg',
      catIds: [catBeef.id, tagZeroLactose.id],
    },
    {
      name: 'Uêvo Uêvolução da Proteína 420g - Explosão de Chocolate',
      slug: 'uevo-uevolucao-proteina-420g',
      price: 69.9,
      stock: 85,
      description:
        'Albumina premium purificada obtida da clara do ovo pasteurizada. Absorção gradual e prolongada (Time-Release).\n\nModo de Uso: Misturar 2 colheres de sopa (28g) em 200ml de água ou shake antes de dormir ou entre refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/6755d15b-bfa9-41b2-b87e-33528c2997c6.jpg',
      catIds: [catOvo.id, tagZeroLactose.id, tagSemGluten.id],
    },

    // ---------------------------------------------------------
    // EMAGRECIMENTO & TERMOGÊNICOS
    // ---------------------------------------------------------
    {
      name: 'Health Cyde Trinka Abdômen Extreme Thermogenic 60 Caps',
      slug: 'health-cyde-trinka-abdomen-60-caps',
      price: 125.9,
      stock: 45,
      description:
        'Acelerador metabólico extremo. Focado na oxidação lipídica profunda e definição do abdômen.\n\nModo de Uso: Ingerir 2 cápsulas pela manhã ou 30 minutos antes do treino. Evitar consumo próximo ao horário de dormir.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/products/1d09780c-78ce-4225-a10b-5aacea800489.jpg',
      catIds: [catTermo.id, catEmagrecimento.id],
    },
    {
      name: 'Cafeína Anidra 200mg 60 Caps',
      slug: 'cafeina-anidra-200mg-60-caps',
      price: 49.9,
      stock: 150,
      description:
        'Cafeína pura concentrada para aumento do estado de alerta físico, queima de gordura e foco inabalável.\n\nModo de Uso: Tomar 1 cápsula (200mg) cerca de 30 a 45 minutos antes da atividade física.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/3feeabf1-2685-4310-aa7b-3c880ac632ac.jpg',
      catIds: [catTermo.id, catEmagrecimento.id],
    },
    {
      name: 'Body Action L-Carnitina 2000 480ml - Abacaxi com Hortelã',
      slug: 'body-action-l-carnitina-480ml',
      price: 89.9,
      stock: 60,
      description:
        'L-Carnitina líquida ultra pura. Atua no transporte de ácidos graxos livres para dentro das mitocôndrias.\n\nModo de Uso: Ingerir 30ml (2 colheres de sopa) ao dia, preferencialmente 30 minutos antes do início dos exercícios.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/6c452769-e142-4172-a501-63b39d41847a.jpg',
      catIds: [catEmagrecimento.id],
    },
    {
      name: 'Bull Pharma Skinni Bull Extreme Power 60 Caps',
      slug: 'bull-pharma-skinni-bull-60-caps',
      price: 139.9,
      stock: 40,
      description:
        'Fórmula termogênica agressiva com Ioimbina HCL para mobilização de gordura em áreas de difícil queima.\n\nModo de Uso: Tomar 1 cápsula ao dia pela manhã em jejum ou antes do treino conforme tolerância individual.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/6d1e0c68-3365-4a06-ba00-ed755e5c9ab9.jpg',
      catIds: [catTermo.id, catEmagrecimento.id],
    },
    {
      name: 'Under Labz Dimethylex Thermogenic Stim Free (Azul) 60 Caps',
      slug: 'under-labz-dimethylex-stim-free-60-caps',
      price: 159.9,
      stock: 35,
      description:
        'Queimador de gordura livre de estimulantes (Cafeína Free). Perfeito para uso noturno ou indivíduos sensíveis.\n\nModo de Uso: Ingerir 2 cápsulas ao dia, preferencialmente antes do treino noturno ou janta.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/882b237f-4db8-464d-abad-03226f6ec664.jpg',
      catIds: [catTermo.id, catEmagrecimento.id, tagSemCafeina.id],
    },
    {
      name: 'Under Labz Dimethylex Thermogenic Fat Burner (Vermelho) 60 Caps',
      slug: 'under-labz-dimethylex-fat-burner-60-caps',
      price: 159.9,
      stock: 30,
      description:
        'Termogênico ultra potente de ação lipolítica profunda e liberação sustentada de foco.\n\nModo de Uso: Tomar 2 cápsulas ao dia (1 pela manhã e 1 antes do almoço), não excedendo a dose recomendada.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/4905cc59-e5dc-4873-a3fa-51a5f11e79a6.jpg',
      catIds: [catTermo.id, catEmagrecimento.id],
    },
    {
      name: 'Laboratory Lizard Yohimbine 5mg 90 Tablets',
      slug: 'lizard-yohimbine-5mg-90-tablets',
      price: 99.9,
      stock: 50,
      description:
        'Ioimbina pura isolada. Bloqueia receptores alfa-2 adrenérgicos para derreter as gorduras mais teimosas.\n\nModo de Uso: Tomar 1 a 2 tabletes ao dia, preferencialmente em jejum antes de atividades cardiovasculares (AEJ).',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/7316cad8-8290-44de-98d7-e48702e8a3e2.jpg',
      catIds: [catTermo.id, catEmagrecimento.id],
    },
    {
      name: 'Diurax Potente Diurético 20 Comprimidos',
      slug: 'diurax-diuretico-20-comprimidos',
      price: 59.9,
      stock: 80,
      description:
        'Fórmula diurética de ação rápida. Elimina a retenção hídrica subcutânea para máxima definição muscular.\n\nModo de Uso: Ingerir 1 comprimido ao dia pela manhã, acompanhado de abundante ingestão de água ao longo do dia.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/daa420fa-16b5-4f1c-981e-70f0283f15fb.jpg',
      catIds: [catEmagrecimento.id],
    },

    // ---------------------------------------------------------
    // LOTE DE NOVOS PRODUTOS: ÔMEGAS, FITOTERÁPICOS E SAÚDE
    // ---------------------------------------------------------
    {
      name: 'Aqualiv (Grupo Althaia) Ômega 3 1.000mg',
      slug: 'aqualiv-omega-3-1000mg-120-caps',
      price: 89.9,
      stock: 50,
      description:
        'Óleo de peixe de águas profundas e geladas. Livre de mercúrio e metais pesados. Selo IFOS.\n\nModo de Uso: Ingerir 2 cápsulas ao dia junto com as principais refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.38.10.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id],
    },
    {
      name: 'Vitafor Omegafor Plus Ultra Concentração 120 Caps',
      slug: 'vitafor-omegafor-plus-120-caps',
      price: 149.9,
      stock: 60,
      description:
        'Suplemento de ômega 3 ultra concentrado fornecendo 990mg EPA e 660mg DHA por dose. Otimização cardiovascular.\n\nModo de Uso: Tomar 1 cápsula 3 vezes ao dia, preferencialmente antes das refeições principais.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.38.34.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id, catMaisVendidos.id],
    },
    {
      name: 'Vitafor Ômega 3 EPA DHA + Vitamina E 120 Caps',
      slug: 'vitafor-omega-3-epa-dha-vitamina-e',
      price: 119.9,
      stock: 75,
      description:
        'Fórmula clássica com ação antioxidante proporcionada pela Vitamina E. Proteção celular contra radicais livres.\n\nModo de Uso: Consumir 1 cápsula 3 vezes ao dia junto com água nas principais refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.38.53.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz Omega-3 Fish Oil Clinical Alta Concentração 60 Caps',
      slug: 'under-labz-omega-3-clinical-60-caps',
      price: 99.9,
      stock: 45,
      description:
        'Grau clínico de óleo de peixe em cápsulas softgel para absorção acelerada. Selo de sustentabilidade MEG-3.\n\nModo de Uso: Tomar 2 cápsulas gelatinosas ao dia, preferencialmente no almoço.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.39.55.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz Omega-3 Fish Oil Clinical Alta Concentração 120 Caps',
      slug: 'under-labz-omega-3-clinical-120-caps',
      price: 169.9,
      stock: 55,
      description:
        'Embalagem econômica de grau clínico. Promove modulação inflamatória e saúde das articulações e cérebro.\n\nModo de Uso: Ingerir 2 cápsulas ao dia junto à refeição que contenha gorduras saudáveis.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.40.16.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz Ômega Ultra Concentrated 60 Caps - Pote Branco',
      slug: 'under-labz-omega-ultra-60-caps',
      price: 119.9,
      stock: 40,
      description:
        'Versão em pote branco com altíssima taxa de pureza molecular por cápsula. Selo IFOS.\n\nModo de Uso: Ingerir 1 cápsula de manhã e 1 cápsula à noite junto com as refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.40.55.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz Ômega Ultra Concentrated 120 Caps - Pote Branco',
      slug: 'under-labz-omega-ultra-120-caps',
      price: 189.9,
      stock: 50,
      description:
        'Pote branco econômico contendo 120 cápsulas. Fornece aporte superior de EPA/DHA para atletas de elite.\n\nModo de Uso: Tomar 2 cápsulas diariamente ao meio-dia com alimentos.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.41.29.jpeg',
      catIds: [catOmegas.id, catSaudeVitaminas.id],
    },
    {
      name: 'Afrodite (You Like a Goddess) 500mg 60 Caps',
      slug: 'afrodite-you-like-a-goddess-60-caps',
      price: 139.9,
      stock: 35,
      description:
        'Fórmula afrodisíaca e moduladora hormonal natural desenvolvida especificamente para a saúde e libido feminina.\n\nModo de Uso: Tomar 2 cápsulas ao dia, preferencialmente pela manhã ou antes de dormir.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.42.55.jpeg',
      catIds: [catFitoHormonal.id, catSaudeVitaminas.id],
    },
    {
      name: 'Bull Pharma Maca Clean Label 750mg 90 Tabs',
      slug: 'bull-pharma-maca-750mg-90-tabs',
      price: 89.9,
      stock: 65,
      description:
        'Maca Peruana pura em tabletes de alta dosagem. Aumenta a vitalidade física, estamina e balanço hormonal.\n\nModo de Uso: Ingerir 2 tabletes ao dia (1 no café da manhã e 1 no almoço).',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.43.16.jpeg',
      catIds: [catFitoHormonal.id],
    },
    {
      name: 'Taurus Pharm Tribullus Maximus Performance 1000mg',
      slug: 'taurus-pharm-tribullus-1000mg',
      price: 119.9,
      stock: 40,
      description:
        'Tribulus Terrestris ultra concentrado com 90% de Saponinas ativas. Estímulo natural para o ganho de massa.\n\nModo de Uso: Tomar 2 cápsulas ao dia, distribuídas ao longo das principais refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.43.29.jpeg',
      catIds: [catFitoHormonal.id],
    },
    {
      name: 'Bull Pharma Tribullus Maximum Performance 1000mg',
      slug: 'bull-pharma-tribullus-performance-1000mg',
      price: 149.9,
      stock: 45,
      description:
        'Fórmula avançada sinérgica contendo Tribulus enriquecido com Maca Peruana preta para máxima modulação hormonal.\n\nModo de Uso: Consumir 2 cápsulas diariamente, preferencialmente 1 hora antes do treinamento físico.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.43.50.jpeg',
      catIds: [catFitoHormonal.id, catMaisVendidos.id],
    },
    {
      name: 'Body Action ZMA GH TESTO 30 Caps',
      slug: 'body-action-zma-gh-testo-30-caps',
      price: 59.9,
      stock: 120,
      description:
        'Complexo mineral anabólico contendo Zinco, Magnésio e Vitamina B6. Melhora a qualidade do sono e a produção endógena de GH.\n\nModo de Uso: Ingerir 1 cápsula ao dia, preferencialmente de 30 a 60 minutos antes de dormir, de estômago vazio.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.44.06.jpeg',
      catIds: [catSaudeVitaminas.id, catFitoHormonal.id],
    },
    {
      name: 'Body Action Complexo B de Vitaminas 60 Caps',
      slug: 'body-action-complexo-b-60-caps',
      price: 49.9,
      stock: 90,
      description:
        'Mix completo de vitaminas do complexo B (B1 a B12) com adição de TCM em cápsulas softgel para absorção celular máxima.\n\nModo de Uso: Ingerir 1 cápsula ao dia junto com uma das principais refeições.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.44.20.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: 'Adaptogen Science Vita Daily 90 Caps',
      slug: 'adaptogen-vita-daily-90-caps',
      price: 79.9,
      stock: 110,
      description:
        'Multivitamínico completo com 21 vitaminas e minerais essenciais para cobrir lacunas nutricionais em atletas.\n\nModo de Uso: Consumir 1 tablete ao dia, preferencialmente logo após o café da manhã.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.44.34.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: "Nutrition'all Relax All 90 Caps",
      slug: 'nutritionall-relax-all-90-caps',
      price: 119.9,
      stock: 50,
      description:
        'Suplemento calmante natural contendo Magnésio, Triptofano e Vitaminas do Complexo B. Combate ansiedade e melhora o ciclo circadiano.\n\nModo de Uso: Ingerir 3 cápsulas à noite antes de deitar ou conforme indicação clínica.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.44.49.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: "Nutrition'all Vitamina D3 2000 UI 60 Caps",
      slug: 'nutritionall-vitamina-d3-2000ui',
      price: 59.9,
      stock: 130,
      description:
        'Vitamina D3 de base oleosa (alta biodisponibilidade). Essencial para a saúde óssea, síntese proteica e sistema imunológico.\n\nModo de Uso: Tomar 1 cápsula ao dia junto a uma refeição que contenha gorduras.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.45.06.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: "Nutrition'all NAC-600 60 Caps",
      slug: 'nutritionall-nac-600-60-caps',
      price: 99.9,
      stock: 60,
      description:
        'N-Acetil L-Cisteína (670mg). Precursor direto da glutatião, o antioxidante mais potente do corpo humano. Proteção hepática e pulmonar.\n\nModo de Uso: Tomar 1 cápsula ao dia longe das refeições ou conforme orientação nutricional.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.45.19.jpeg',
      catIds: [catSaudeVitaminas.id, catAminoacidos.id],
    },
    {
      name: "Nutrition'all Magnésio + Treonina 90 Caps",
      slug: 'nutritionall-magnesio-treonina-90-caps',
      price: 139.9,
      stock: 40,
      description:
        'Magnésio L-Treonina premium. Cruza a barreira hematoencefálica, otimizando funções cognitivas, memória e foco.\n\nModo de Uso: Tomar 3 cápsulas ao dia, preferencialmente divididas entre tarde e noite.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.45.33.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: "Nutrition'all Magnésio Dimalato 60 Caps",
      slug: 'nutritionall-magnesio-dimalato-60-caps',
      price: 79.9,
      stock: 70,
      description:
        'Magnésio quelato associado ao ácido málico. Auxilia no combate a dores musculares crônicas e fadiga crônica.\n\nModo de Uso: Ingerir 2 cápsulas ao dia, preferencialmente pela manhã.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.45.44.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz COQ-10 200mg (Clinical Series) 60 Caps',
      slug: 'under-labz-coq10-clinical-60-caps',
      price: 129.9,
      stock: 55,
      description:
        'Coenzima Q10 concentrada em softgels. Potente ação antioxidante miocárdica e suporte à respiração mitocondrial.\n\nModo de Uso: Tomar 1 cápsula ao dia junto ao almoço.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.46.02.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz COQ-10 200mg (Pote Branco/Red) 60 Caps',
      slug: 'under-labz-coq10-white-60-caps',
      price: 129.9,
      stock: 45,
      description:
        'Coenzima Q10 premium com selo de pureza máxima focado em rejuvenescimento celular e performance cardíaca.\n\nModo de Uso: Ingerir 1 cápsula softgel ao dia acompanhado de refeição sólida.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.46.11.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: 'Under Labz Beta-Alanine 100% Pure 300g',
      slug: 'under-labz-beta-alanine-300g',
      price: 119.9,
      stock: 80,
      description:
        'Beta-Alanina pura monohidratada. Atua elevando os níveis de carnosina muscular para mitigar a acidose e fadiga.\n\nModo de Uso: Diluir 2g (meio dosador) em 200ml de água, fracionando o consumo em doses de 40ml ao longo do dia.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.46.24.jpeg',
      catIds: [catAminoacidos.id],
    },
    {
      name: 'Under Labz Glutamine 100% Pure 300g',
      slug: 'under-labz-glutamine-300g',
      price: 99.9,
      stock: 75,
      description:
        'L-Glutamina isolada de alto valor biológico. Essencial para a integridade dos enterócitos (barreira intestinal) e imunidade.\n\nModo de Uso: Diluir 5g (1 dosador) em 100ml de água ou suco. Consumir pela manhã em jejum ou pós-treino.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.48.00.jpeg',
      catIds: [catAminoacidos.id],
    },
    {
      name: 'Vitafor Glutamax L-Glutamina Alta Pureza 300g',
      slug: 'vitafor-glutamax-300g',
      price: 129.9,
      stock: 90,
      description:
        'Glutamina com certificação internacional de pureza. Aminoácido isolado de solubilidade total e sem sabor.\n\nModo de Uso: Dissolver 5g em 150ml de água mineral líquida e consumir em jejum ou conforme indicação clínica.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.48.12.jpeg',
      catIds: [catAminoacidos.id, catMaisVendidos.id],
    },
    {
      name: 'Belissima Collagen+ Verisol 264g - Laranja + Acerola',
      slug: 'belissima-collagen-verisol-264g',
      price: 159.9,
      stock: 40,
      description:
        'Peptídeos bioativos de colágeno Verisol enriquecidos com ácido hialurônico, biotina e minerais para regeneração dérmica e capilar.\n\nModo de Uso: Misturar 8.8g (1 colher de sopa) em 200ml de água pela manhã ou à noite antes de deitar.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.48.27.jpeg',
      catIds: [catSaudeVitaminas.id],
    },
    {
      name: 'Dr. Peanut Pasta de Amendoim Bueníssimo 600g',
      slug: 'dr-peanut-buenissimo-600g',
      price: 39.9,
      stock: 200,
      description:
        'Pasta de amendoim gourmet com zero adição de açúcares, saborizada com avelã, chocolate e pedaços de wafer crocante.\n\nModo de Uso: Consumir de 1 a 2 colheres de sopa ao dia como aporte de gorduras boas ou pré-treino calórico.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.49.21.jpeg',
      catIds: [catAlimentos.id, catMaisVendidos.id, tagSemGluten.id],
    },
    {
      name: 'Body Action Energel Black Caixa (10 Sachês de 30g)',
      slug: 'body-action-energel-black-caixa',
      price: 45.0,
      stock: 150,
      description:
        'Gel de carboidratos sequenciais (Maltodextrina, Frutose e Palatinose) com Cafeína e D-Ribose para reposição instantânea de glicogênio.\n\nModo de Uso: Consumir 1 sachê de 30g a cada 30-45 minutos de exercícios de endurance intensos.',
      imageUrl:
        'https://pub-bafc1d447702426098685b6529ea4e5b.r2.dev/WhatsApp%20Image%202026-06-08%20at%2012.50.08.jpeg',
      catIds: [catAlimentos.id],
    },
  ];

  console.log('⚡ Executando inserts sequenciais no banco...');

  for (const product of productsData) {
    await prisma.product.create({
      data: {
        name: product.name,
        slug: product.slug,
        price: product.price,
        stock: product.stock,
        description: product.description,
        imageUrl: product.imageUrl,
        categories: {
          connect: product.catIds.map((id) => ({ id })),
        },
      },
    });
  }

  console.log(
    `✅ Seed finalizado com sucesso! Todos os 76 produtos foram estruturados com Modo de Uso.`,
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
