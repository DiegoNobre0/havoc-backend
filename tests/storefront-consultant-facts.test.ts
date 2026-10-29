import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConsultantCandidate } from '../src/modules/storefrontConsultant/storefrontConsultant.catalog.js';
import {
  detectFactIntents,
  formatOfficialFactsResponse,
  isGenericUsageQuestion,
  publishableLabelFacts,
  resolveSingleProductCandidate,
} from '../src/modules/storefrontConsultant/storefrontConsultant.facts.js';

function product(
  id: string,
  name: string,
  labelFacts: Extract<ConsultantCandidate, { type: 'product' }>['labelFacts'] = null,
): Extract<ConsultantCandidate, { type: 'product' }> {
  return {
    type: 'product',
    id,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    name,
    description: '',
    imageUrl: null,
    price: 99.9,
    available: true,
    categories: [],
    labelFacts,
  };
}

test('detects each official fact intent deterministically', () => {
  assert.deepEqual(
    detectFactIntents(
      'Qual a dose, tabela nutricional, ingredientes, alérgenos, advertências e fonte do fabricante?',
    ),
    ['usage', 'nutrition', 'ingredients', 'allergens', 'warnings', 'source'],
  );
  assert.deepEqual(detectFactIntents('Quero uma proteína'), []);
  assert.deepEqual(detectFactIntents('Não uso medicamentos.'), []);
  assert.deepEqual(detectFactIntents('Oi, queria saber como usa creatina'), ['usage']);
  assert.deepEqual(detectFactIntents('Whey isolado não tem lactose?'), ['allergens']);
  assert.deepEqual(detectFactIntents('Quero whey sem glúten'), ['allergens']);
  assert.equal(isGenericUsageQuestion('Oi, queria saber como usa creatina'), true);
  assert.equal(isGenericUsageQuestion('Como tomar BCAA?'), true);
  assert.equal(isGenericUsageQuestion('Como usar beta alanina?'), true);
  assert.equal(isGenericUsageQuestion('Como usa Creatina Hardcore 300g?'), false);
});

test('publishes facts only for exact matched official sources', () => {
  const label = {
    manufacturer: 'Marca',
    manufacturerDomain: 'marca.example',
    sourceUrl: 'https://marca.example/produto',
    sourceTitle: 'Produto',
    sourceRetrievedAt: new Date('2026-10-23T12:00:00.000Z'),
    servingSize: '5 g',
    servingsPerContainer: null,
    usageInstructions: null,
    ingredients: null,
    allergenStatement: null,
    warnings: null,
    nutritionFacts: null,
    status: 'SOURCE_MATCHED',
    exactProductMatch: true,
  };
  assert.equal(publishableLabelFacts(label)?.servingSize, '5 g');
  assert.equal(publishableLabelFacts({ ...label, status: 'NOT_FOUND' }), null);
  assert.equal(publishableLabelFacts({ ...label, exactProductMatch: false }), null);
});

test('formats only requested literal facts without converting values', () => {
  const candidate = product('one', 'Creatina Exata 300g', {
    manufacturer: 'Marca Exata',
    manufacturerDomain: 'marca.example',
    servingSize: '5 g (1 dosador)',
    servingsPerContainer: '60 porções',
    usageInstructions: 'Misturar 1 dosador em 200 ml de água.',
    ingredients: 'Creatina monohidratada.',
    allergenStatement: 'PODE CONTER LEITE.',
    warnings: ['Não exceder a recomendação diária indicada na embalagem.'],
    nutritionFacts: [
      { nutrient: 'Creatina', amount: { value: 5000, unit: 'mg' }, dailyValuePercent: null },
      { nutrient: 'Sódio', amount: '0 mg', dailyValuePercent: 0 },
    ],
    source: {
      title: 'Creatina Exata - rótulo',
      url: 'https://marca.example/creatina-exata',
      retrievedAt: '2026-10-23T12:00:00.000Z',
    },
  });

  const response = formatOfficialFactsResponse(candidate, ['usage', 'nutrition']);
  assert.match(response, /Porção: 5 g \(1 dosador\)/);
  assert.match(response, /Creatina: 5000 mg \| %VD: não informado/);
  assert.match(response, /Sódio: 0 mg \| %VD: 0%/);
  assert.doesNotMatch(response, /PODE CONTER LEITE/);
  assert.match(response, /Fonte oficial: Creatina Exata - rótulo/);
  assert.match(response, /https:\/\/marca\.example\/creatina-exata/);
  assert.doesNotMatch(response, /\b3\s*g\b/i);

  const source = formatOfficialFactsResponse(candidate, ['source']);
  assert.match(source, /https:\/\/marca\.example\/creatina-exata/);
  assert.doesNotMatch(source, /Porção:/);
});

test('does not choose an arbitrary creatine for a generic dose question', () => {
  const candidates = [product('one', 'Creatina Alpha'), product('two', 'Creatina Beta')];
  assert.equal(resolveSingleProductCandidate('qual dose de creatina?', candidates), null);
});

test('does not assume the only catalog result is the intended product', () => {
  const candidate = product('one', 'Creatina Alpha 300g');
  assert.equal(resolveSingleProductCandidate('como usa creatina?', [candidate]), null);
  assert.equal(resolveSingleProductCandidate('como usa Creatina Alpha 300g?', [candidate])?.id, 'one');
});

test('uses the product page context but lets an explicit product name override it', () => {
  const pageProduct = { ...product('one', 'Creatina Alpha'), contextMatch: true };
  const otherProduct = product('two', 'Creatina Beta');
  const candidates = [pageProduct, otherProduct];

  assert.equal(resolveSingleProductCandidate('como posso usar a creatina?', candidates)?.id, 'one');
  assert.equal(resolveSingleProductCandidate('como usar a Creatina Beta?', candidates)?.id, 'two');
  assert.equal(
    resolveSingleProductCandidate('como posso usar a creatina?', candidates.map((item) => ({
      ...item,
      contextMatch: false,
    }))),
    null,
  );
});

test('selects a product from recent recommendations by ordinal reference', () => {
  const candidates = [
    product('one', 'Creatina Alpha'),
    product('two', 'Creatina Beta'),
    product('three', 'Creatina Gamma'),
  ];
  assert.equal(resolveSingleProductCandidate('como toma a primeira?', candidates)?.id, 'one');
  assert.equal(resolveSingleProductCandidate('dose da opção 2', candidates)?.id, 'two');
  assert.equal(resolveSingleProductCandidate('tabela da terceira', candidates)?.id, 'three');
  assert.equal(resolveSingleProductCandidate('1', candidates)?.id, 'one');
  assert.equal(resolveSingleProductCandidate('2', candidates)?.id, 'two');
  assert.equal(resolveSingleProductCandidate('3', candidates)?.id, 'three');
});

test('never resolves a kit to one of its product facts', () => {
  const candidates: ConsultantCandidate[] = [
    product('one', 'Creatina Alpha'),
    {
      type: 'kit',
      id: 'kit',
      slug: 'kit-creatina-alpha',
      name: 'Kit Creatina Alpha',
      description: '',
      imageUrl: null,
      price: 149.9,
      available: true,
    },
  ];
  assert.equal(resolveSingleProductCandidate('ingredientes do Kit Creatina Alpha', candidates), null);
});

test('reports unavailable official data instead of supplying a product dose', () => {
  const response = formatOfficialFactsResponse(product('one', 'Creatina Sem Rótulo'), ['usage']);
  assert.match(response, /ainda não estão registrados/);
  assert.match(response, /rótulo do produto ou consulte o fabricante/);
  assert.doesNotMatch(response, /\b3\s*g\b/i);
});
