import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conciseCommonUsageAnswer,
  shouldResearchGeneralQuestion,
  trustedResearchDomain,
  trustedRetailDomain,
  wantsResearchSources,
} from '../src/modules/storefrontConsultant/storefrontConsultant.research.js';

test('classifies evidence questions without treating shopping requests as research', () => {
  assert.equal(shouldResearchGeneralQuestion('Para que serve creatina?'), true);
  assert.equal(shouldResearchGeneralQuestion('Qual a diferença entre whey isolado e concentrado?'), true);
  assert.equal(shouldResearchGeneralQuestion('Creatina faz mal?'), true);
  assert.equal(shouldResearchGeneralQuestion('Qual é o melhor horário para tomar creatina?'), true);
  assert.equal(shouldResearchGeneralQuestion('Preciso de uma creatina'), false);
});

test('accepts only explicitly trusted retail domains for product-label fallback', () => {
  assert.equal(trustedRetailDomain('www.banca13.com.br'), 'banca13.com.br');
  assert.equal(trustedRetailDomain('www.drogaraia.com.br'), 'drogaraia.com.br');
  assert.equal(trustedRetailDomain('mercadolivre.com.br'), null);
  assert.equal(trustedRetailDomain('banca13.com.br.example.com'), null);
});

test('accepts institutional research domains and rejects arbitrary sources', () => {
  assert.equal(trustedResearchDomain('ods.od.nih.gov'), 'nih.gov');
  assert.equal(trustedResearchDomain('www.gov.br'), 'gov.br');
  assert.equal(trustedResearchDomain('blog-loja.example'), null);
  assert.equal(trustedResearchDomain('nih.gov.example.com'), null);
});

test('shows research links only when the customer asks for them', () => {
  assert.equal(wantsResearchSources('Como usar creatina?'), false);
  assert.equal(wantsResearchSources('Qual a fonte dessa informação?'), true);
  assert.equal(wantsResearchSources('Tem estudos sobre creatina?'), true);
});

test('keeps common creatine usage practical and short', () => {
  const answer = conciseCommonUsageAnswer('Oi, como posso usar creatina?');
  assert.match(answer ?? '', /3 a 5 g por dia/);
  assert.match(answer ?? '', /todos os dias/);
  assert.ok((answer?.length ?? 0) < 250);
  assert.doesNotMatch(answer ?? '', /benefício|estudo|fonte/i);
});
