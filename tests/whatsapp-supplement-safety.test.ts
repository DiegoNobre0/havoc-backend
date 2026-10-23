import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSupplementSafety } from '../src/integrations/IA/supplement-safety.policy.js';

test('allows catalog questions in the WhatsApp consultant', () => {
  assert.deepEqual(evaluateSupplementSafety('Quais sabores de whey vocês têm?'), {
    blocked: false,
  });
});

test('blocks stimulant recommendation with pressure medication', () => {
  const result = evaluateSupplementSafety(
    'Quero termogênico, mas uso medicamento para pressão alta.',
  );

  assert.equal(result.blocked, true);
  assert.match(result.response ?? '', /não consigo avaliar com segurança/);
  assert.match(result.response ?? '', /médico ou nutricionista/);
});

test('blocks checkout and payment actions', () => {
  const result = evaluateSupplementSafety('Pode finalizar pedido e gerar pix para mim?');

  assert.equal(result.blocked, true);
  assert.match(result.response ?? '', /checkout da loja online/);
});

test('routes emergencies to immediate care', () => {
  const result = evaluateSupplementSafety('Estou com dor no peito e falta de ar.');

  assert.equal(result.blocked, true);
  assert.match(result.response ?? '', /atendimento médico imediato/);
  assert.match(result.response ?? '', /SAMU \(192\)/);
});
