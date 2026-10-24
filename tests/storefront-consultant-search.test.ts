import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctSearchTokens,
  damerauLevenshteinDistance,
  isReferentialRequest,
  normalizeSearchText,
  searchCatalog,
  tokenizeSearchText,
  type CatalogSearchDocument,
} from '../src/modules/storefrontConsultant/storefrontConsultant.search.js';

const documents: CatalogSearchDocument[] = [
  {
    type: 'product',
    id: 'creatine-id',
    slug: 'creatine-monohidratada',
    name: 'Creatine Monohidratada',
    available: true,
    categories: ['Creatina'],
  },
  {
    type: 'product',
    id: 'whey-id',
    slug: 'whey-protein-isolado',
    name: 'Whey Protein Isolado',
    available: true,
    categories: ['Proteínas'],
  },
  {
    type: 'product',
    id: 'whey-unavailable-id',
    slug: 'whey-concentrado',
    name: 'Whey Protein Concentrado',
    available: false,
    categories: ['Proteínas'],
  },
];

test('normalizes accents, punctuation and hyphens and removes common stopwords', () => {
  assert.equal(normalizeSearchText('  PRÉ-treino?!  '), 'pre treino');
  assert.deepEqual(tokenizeSearchText('Quero uma proteína, por favor!'), ['proteina', 'favor']);
});

test('does not correct conversational words into product attributes', () => {
  const results = searchCatalog('quero saber como toma a cretinha', documents);
  assert.deepEqual(results.map(({ document }) => document.id), ['creatine-id']);
});

test('maps Portuguese and English catalog aliases to the same search token', () => {
  assert.deepEqual(tokenizeSearchText('pre-workout mass gainer collagen'), [
    'pre-treino',
    'hipercalorico',
    'colageno',
  ]);
  assert.deepEqual(tokenizeSearchText('thermogenic glutamine whey'), [
    'termogenico',
    'glutamina',
    'proteina',
  ]);
  assert.deepEqual(tokenizeSearchText('3way 3 whey three whey'), [
    'proteina',
    'proteina',
    'proteina',
  ]);
});

test('corrects eligible typos with Damerau-Levenshtein distance but not short tokens', () => {
  assert.equal(damerauLevenshteinDistance('cretina', 'creatina'), 1);
  assert.equal(damerauLevenshteinDistance('proteian', 'proteina'), 1);
  assert.deepEqual(correctSearchTokens(['cretina', 'whey'], ['creatina', 'whey']), [
    'creatina',
    'whey',
  ]);
});

test('resolves cretina to creatine and never falls back to contextual whey', () => {
  const results = searchCatalog('e cretina?', documents, {
    type: 'product',
    id: 'whey-id',
    slug: 'whey-protein-isolado',
  });

  assert.deepEqual(
    results.map(({ document }) => document.id),
    ['creatine-id'],
  );
  assert.deepEqual(results[0]?.correctedTokens, ['creatina']);
});

test('includes context only for referential requests', () => {
  const context = { type: 'product' as const, id: 'whey-id', slug: 'whey-protein-isolado' };
  assert.equal(isReferentialRequest('Como usa?'), true);
  assert.equal(isReferentialRequest('Mostre a tabela dele'), true);
  assert.equal(isReferentialRequest('Quero creatina'), false);
  assert.deepEqual(
    searchCatalog('como usa?', documents, context).map((item) => item.document.id),
    ['whey-id'],
  );
  assert.deepEqual(
    searchCatalog('creatina', documents, context).map((item) => item.document.id),
    ['creatine-id'],
  );
});

test('recognizes natural usage follow-ups and numeric selections as references', () => {
  assert.equal(isReferentialRequest('como posso usar a creatina?'), true);
  assert.equal(isReferentialRequest('como eu deveria tomar?'), true);
  assert.equal(isReferentialRequest('2'), true);
});

test('returns no arbitrary candidates for empty and unmatched searches', () => {
  assert.deepEqual(searchCatalog('', documents), []);
  assert.deepEqual(searchCatalog('astronauta', documents), []);
  assert.deepEqual(searchCatalog('esse produto', documents), []);
});

test('still searches explicit terms in a referential phrase without page context', () => {
  assert.deepEqual(
    searchCatalog('como usar creatina?', documents).map(({ document }) => document.id),
    ['creatine-id'],
  );
});

test('ignores fact-intent words when matching the requested product', () => {
  assert.deepEqual(
    searchCatalog('qual a tabela nutricional da creatina?', documents).map(
      ({ document }) => document.id,
    ),
    ['creatine-id'],
  );
});

test('ignores conversational introductions in supplement questions', () => {
  assert.deepEqual(
    searchCatalog('oi, queria saber como usa creatina', documents).map(
      ({ document }) => document.id,
    ),
    ['creatine-id'],
  );
});

test('uses deterministic relevance ordering with availability as the tie-breaker', () => {
  const results = searchCatalog('whey', documents);
  assert.deepEqual(
    results.map(({ document }) => document.id),
    ['whey-id', 'whey-unavailable-id'],
  );
});
