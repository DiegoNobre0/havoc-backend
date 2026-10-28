import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClippInventoryText } from '../src/modules/catalog/products/product-import.parser.js';
import { productImportFamilyKey } from '../src/modules/catalog/products/product-import.utils.js';

const header =
  'Código   Descrição Quantidade Unitário Qtd x Preço Qtd x Custo Qtd x C. Médio';

test('parses CLIPP price, stock and unit cost without AI', () => {
  const parsed = parseClippInventoryText(`${header}
547 whey noble vinix velvet supreme 12,00 140,00 1.680,00 1.080,00 0,00
516 GOLD WHEY CHOCOLATE ADAPTOGEN 900G 2,00 220,00 440,00 286,00 0,00
489 PROTEIN CRUSH VITAMIINA DE FRUTAS 900G UNDER 4,00 130,00 520,00 336,00 0,00
488 PROTEIN CRUSH ALPINE MILK 900G UNDER 0,00 130,00 0,00 0,00 0,00
552 PIPOCA PROTEICA UEVO CARAMELO C FLOR DE SAL 75GR 20,00 20,00 400,00 180,00 0,00
Relatório gerado em 31/07/2026`);

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.items.map(({ sku, stock, price, cost }) => ({ sku, stock, price, cost })),
    [
      { sku: '547', stock: 12, price: 140, cost: 90 },
      { sku: '516', stock: 2, price: 220, cost: 143 },
      { sku: '489', stock: 4, price: 130, cost: 84 },
      { sku: '488', stock: 0, price: 130, cost: undefined },
      { sku: '552', stock: 20, price: 20, cost: 9 },
    ],
  );
});

test('reconstructs wrapped CLIPP rows and displaced description fragments', () => {
  const parsed = parseClippInventoryText(`${header}
430 WHEY PROTEIN CONCENTRADO SABOR CARAMELO SALGADO 2,00
POTE 900G 250,00
dux 500,00 340,00 0,00
550 CREATINE Sem Sabor Refil Stand Up Pouch 500g Black Skull Caveira
4,00Preta 120,00 480,00 220,00 0,00
411 DIABO VERDE CREATINA 100 PURA SABOR NEUTRO 300G FTW0,00 89,90 0,00 0,00 0,00
Relatório gerado em 31/07/2026`);

  assert.deepEqual(parsed.errors, []);
  assert.match(parsed.items[0]!.name, /POTE 900G dux/);
  assert.deepEqual(
    parsed.items.map(({ sku, stock, price, cost }) => ({ sku, stock, price, cost })),
    [
      { sku: '430', stock: 2, price: 250, cost: 170 },
      { sku: '550', stock: 4, price: 120, cost: 55 },
      { sku: '411', stock: 0, price: 89.9, cost: undefined },
    ],
  );
  assert.match(parsed.items[1]!.name, /Caveira Preta/);
});

test('rejects a shifted row when quantity times unit price does not match the total', () => {
  const parsed = parseClippInventoryText(`${header}
547 whey noble vinix chocolate 21,00 14,00 1.680,00 1.080,00 0,00
Relatório gerado em 31/07/2026`);

  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0]!.reason, /Qtd x Preço inconsistente/);
});

test('ignores report totals appended to the final product row', () => {
  const parsed = parseClippInventoryText(`${header}
447 Whey Protein Isolado Coco 900g DUX 0,00 350,00 0,00 0,00 0,00 261.010,60 134.099,99 0,00 Totais: 2.742,00`);

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.items[0], {
    sku: '447',
    name: 'Whey Protein Isolado Coco 900g DUX',
    stock: 0,
    price: 350,
    quantityPrice: 0,
    quantityCost: 0,
  });
});

test('groups flavors of the same product family for researched categorization', () => {
  assert.equal(
    productImportFamilyKey('GOLD WHEY COOKIES E CREAM ADAPTOGEN 900G'),
    productImportFamilyKey('GOLD WHEY CHOCOLATE ADAPTOGEN 900G'),
  );
  assert.equal(
    productImportFamilyKey('PROTEIN CRUSH ALPINE MILK 900G UNDER'),
    productImportFamilyKey('PROTEIN CRUSH VITAMIINA DE FRUTAS 900G UNDER'),
  );
});
