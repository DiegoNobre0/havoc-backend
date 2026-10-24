import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateConsultantSafety } from '../src/modules/storefrontConsultant/storefrontConsultant.policy.js';
import {
  buildConsultantTranscriptionPrompt,
  consultantAudioExtension,
  normalizeConsultantTranscript,
  validateConsultantTranscript,
} from '../src/modules/storefrontConsultant/storefrontConsultant.audio.js';
import {
  allowsConsultantRecommendations,
  hasExplicitCommercialIntent,
} from '../src/modules/storefrontConsultant/storefrontConsultant.intent.js';
import { AppError } from '../src/shared/errors/AppError.js';

test('allows general supplement questions', () => {
  assert.deepEqual(
    evaluateConsultantSafety('Qual a diferença entre whey concentrado e isolado?'),
    { blocked: false },
  );
});

test('uses the stimulant warning for thermogenic and pressure medication', () => {
  const result = evaluateConsultantSafety(
    'Posso tomar termogênico? Uso medicamento para pressão alta.',
  );

  assert.equal(result.blocked, true);
  assert.match(result.content, /Termogênicos podem conter estimulantes como cafeína/);
  assert.match(result.content, /Consulte seu médico ou nutricionista/);
});

test('does not mention thermogenics for an unrelated medication question', () => {
  const result = evaluateConsultantSafety('Uso remédio para pressão. Posso tomar whey?');

  assert.equal(result.blocked, true);
  assert.doesNotMatch(result.content, /Termogênicos/);
  assert.match(result.content, /médico ou nutricionista/);
});

test('keeps health conditions on the safety path instead of giving a generic dose', () => {
  const result = evaluateConsultantSafety('Tenho problema renal, como usar creatina?');
  assert.equal(result.blocked, true);
  assert.match(result.content, /condição de saúde/);
  assert.doesNotMatch(result.content, /3 a 5 g/);
});

test('does not treat explicit health and medication negations as risks', () => {
  assert.deepEqual(
    evaluateConsultantSafety(
      'Não tenho nenhuma doença e não uso medicamentos, pode ser com cafeína.',
    ),
    { blocked: false },
  );
});

test('routes emergency symptoms to immediate care without recommendations', () => {
  const result = evaluateConsultantSafety('Tomei um suplemento e estou com falta de ar.');

  assert.equal(result.blocked, true);
  assert.match(result.content, /atendimento imediato/);
  assert.match(result.content, /SAMU 192/);
});

test('accepts allowlisted audio MIME types with codec parameters', () => {
  assert.equal(consultantAudioExtension('audio/webm;codecs=opus'), '.webm');
  assert.equal(consultantAudioExtension('audio/x-m4a'), '.m4a');
  assert.equal(consultantAudioExtension('application/octet-stream'), null);
});

test('trims a valid consultant transcript', () => {
  assert.equal(validateConsultantTranscript('  Quero whey  '), 'Quero whey');
});

test('normalizes common audio spellings of 3 whey', () => {
  assert.equal(
    normalizeConsultantTranscript('E o 3way, como é que funciona?'),
    'E o 3 whey, como é que funciona?',
  );
  assert.equal(normalizeConsultantTranscript('Quero o three way'), 'Quero o 3 whey');
});

test('builds a bounded transcription prompt with recent conversation context', () => {
  const prompt = buildConsultantTranscriptionPrompt([
    'Quero entender as diferenças entre os tipos de whey.',
    'Mensagem antiga '.repeat(100),
    'E o isolado?',
  ]);
  assert.match(prompt, /Vocabulário: whey protein, 3 whey/);
  assert.match(prompt, /E o isolado\?/);
  assert.ok(prompt.length < 850);
});

test('allows cards only for explicit shopping requests or valid screening answers', () => {
  assert.equal(hasExplicitCommercialIntent('Quero whey sem lactose'), true);
  assert.equal(hasExplicitCommercialIntent('Me mostre opções de whey'), true);
  assert.equal(hasExplicitCommercialIntent('Quanto custa a creatina?'), true);
  assert.equal(hasExplicitCommercialIntent('Quero saber quanto custa a creatina'), true);
  assert.equal(hasExplicitCommercialIntent('Quero saber como funciona o 3 whey'), false);
  assert.equal(hasExplicitCommercialIntent('Quero uma informação sobre whey'), false);
  assert.equal(hasExplicitCommercialIntent('Qual é o valor nutricional desse whey?'), false);
  assert.equal(hasExplicitCommercialIntent('Whey isolado não tem lactose?'), false);
  assert.equal(allowsConsultantRecommendations('Não tenho doenças e não uso remédios', true, true), true);
  assert.equal(allowsConsultantRecommendations('Como funciona a cafeína?', true, true), false);
  assert.equal(allowsConsultantRecommendations('Não tenho doenças', true, false), false);
});

test('rejects empty and oversized consultant transcripts safely', () => {
  assert.throws(
    () => validateConsultantTranscript('   '),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
  assert.throws(
    () => validateConsultantTranscript('a'.repeat(501)),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
});
