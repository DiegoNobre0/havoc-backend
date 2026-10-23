import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/shared/errors/AppError.js';
import {
  hostnameMatchesDomain,
  manufacturerDomainSchema,
  manufacturerSourceUrlSchema,
  nutritionFactsSchema,
  validateLiteralExtraction,
} from '../src/modules/catalog/productFacts/product-facts.schemas.js';
import {
  isPrivateAddress,
  validateManufacturerSourceUrl,
} from '../src/modules/catalog/productFacts/product-facts.service.js';

test('accepts manufacturer domains and official subdomains only', () => {
  assert.equal(manufacturerDomainSchema.parse('  fabricante.com.br '), 'fabricante.com.br');
  assert.equal(hostnameMatchesDomain('www.fabricante.com.br', 'fabricante.com.br'), true);
  assert.equal(hostnameMatchesDomain('fabricante.com.br.evil.test', 'fabricante.com.br'), false);
  assert.throws(() => manufacturerDomainSchema.parse('https://fabricante.com.br/produto'));
  assert.throws(() => manufacturerDomainSchema.parse('localhost'));
  assert.throws(() => manufacturerDomainSchema.parse('127.0.0.1'));
});

test('allows only HTTP source URLs without credentials, ports, or foreign hosts', () => {
  assert.equal(
    validateManufacturerSourceUrl(
      'https://produtos.fabricante.com.br/rotulo.pdf',
      'fabricante.com.br',
    ).hostname,
    'produtos.fabricante.com.br',
  );
  assert.throws(() => manufacturerSourceUrlSchema.parse('file:///etc/passwd'));
  assert.throws(() => manufacturerSourceUrlSchema.parse('https://user:pass@fabricante.com.br/a'));
  assert.throws(
    () => validateManufacturerSourceUrl('https://marketplace.example/item', 'fabricante.com.br'),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test('recognizes private and non-routable network addresses', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.2.3.4'), true);
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('nutrition rows preserve ordered Brazilian label text and numeric units', () => {
  const rows = nutritionFactsSchema.parse([
    { nutrient: 'Valor energético', amount: '120 kcal = 504 kJ', dailyValuePercent: 6 },
    { nutrient: 'Sódio', amount: { value: 80, unit: 'mg' }, dailyValuePercent: null },
  ]);
  assert.equal(rows[0]?.nutrient, 'Valor energético');
  assert.deepEqual(rows[1]?.amount, { value: 80, unit: 'mg' });
  assert.throws(() =>
    nutritionFactsSchema.parse([{ nutrient: 'Sódio', amount: '', dailyValuePercent: null }]),
  );
});

const emptyFacts = {
  servingsPerContainer: null,
  usageInstructions: null,
  ingredients: null,
  allergenStatement: null,
  warnings: null,
  nutritionFacts: null,
};

test('accepts exact extraction only when identity and fact evidence are literal', () => {
  const source = 'Produto Whey Exato 900 g. Porção: 30 g. Ingredientes: proteína do soro do leite.';
  const parsed = validateLiteralExtraction(
    {
      exactProductMatch: true,
      identityEvidence: ['Produto Whey Exato 900 g'],
      sourceTitle: 'Produto Whey Exato',
      servingSize: { value: '30 g', evidence: ['Porção: 30 g'] },
      ...emptyFacts,
      ingredients: {
        value: 'proteína do soro do leite',
        evidence: ['Ingredientes: proteína do soro do leite'],
      },
    },
    source,
  );
  assert.equal(parsed.servingSize?.value, '30 g');
});

test('rejects mismatch, empty facts, and evidence absent from source', () => {
  assert.throws(() =>
    validateLiteralExtraction(
      {
        exactProductMatch: false,
        identityEvidence: ['Outro produto'],
        sourceTitle: null,
        servingSize: null,
        ...emptyFacts,
      },
      'Outro produto',
    ),
  );
  assert.throws(() =>
    validateLiteralExtraction(
      {
        exactProductMatch: true,
        identityEvidence: ['Produto Exato'],
        sourceTitle: null,
        servingSize: null,
        ...emptyFacts,
      },
      'Produto Exato',
    ),
  );
  assert.throws(() =>
    validateLiteralExtraction(
      {
        exactProductMatch: true,
        identityEvidence: ['Produto Exato'],
        sourceTitle: null,
        servingSize: { value: '30 g', evidence: ['Porção inventada: 30 g'] },
        ...emptyFacts,
      },
      'Produto Exato. Porção: 20 g.',
    ),
  );
});
