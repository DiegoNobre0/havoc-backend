const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const includesAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

const medicationTerms = ['medicamento', 'remedio', 'medicacao', 'farmaco'];
const pressureTerms = ['pressao', 'hipertens', 'anti-hipertens'];
const stimulantTerms = ['termogenic', 'cafeina', 'pre treino', 'pre-treino', 'estimulante'];
const emergencyTerms = [
  'dor no peito',
  'desmaio',
  'desmaiando',
  'falta de ar',
  'dificuldade para respirar',
  'nao consigo respirar',
];
const pregnancyTerms = ['gravida', 'gravidez', 'gestante', 'amament', 'lactante'];
const minorTerms = ['crianca', 'adolescente', 'menor de idade', 'meu filho', 'minha filha'];
const diseaseTerms = [
  'doenca',
  'diabetes',
  'asma',
  'cardiopatia',
  'problema cardiaco',
  'problema renal',
  'problema no rim',
  'insuficiencia renal',
  'doenca autoimune',
  'cancer',
  'epilepsia',
];
const reactionTerms = [
  'alergia',
  'alergico',
  'reacao adversa',
  'efeito colateral',
  'palpitacao',
  'passando mal',
];

export type SafetyDecision = { blocked: false } | { blocked: true; content: string };

export function evaluateConsultantSafety(content: string): SafetyDecision {
  const text = normalize(content);
  const deniesMedication =
    /\bnao\s+(?:uso|tomo|utilizo)\s+(?:nenhum(?:a|s)?\s+)?(?:medicamentos?|remedios?|medicacoes?)\b/.test(
      text,
    );
  const deniesPressure = /\bnao\s+(?:tenho|possuo)\s+(?:pressao|hipertensao)\b/.test(text);
  const deniesCondition =
    /\bnao\s+(?:tenho|possuo)\s+(?:nenhuma\s+)?(?:doenca|condicao|problema de saude)\b/.test(text);

  if (includesAny(text, emergencyTerms)) {
    return {
      blocked: true,
      content:
        'Esses sinais podem exigir atendimento imediato. Não use suplementos para tentar tratar os sintomas. Procure agora um serviço de urgência ou emergência (SAMU 192), especialmente se houver dor no peito, desmaio ou dificuldade para respirar.',
    };
  }

  const mentionsMedication = includesAny(text, medicationTerms) && !deniesMedication;
  const mentionsPressure = includesAny(text, pressureTerms) && !deniesPressure;
  const mentionsStimulant = includesAny(text, stimulantTerms);
  if (mentionsMedication && mentionsPressure && mentionsStimulant) {
    return {
      blocked: true,
      content:
        'Termogênicos podem conter estimulantes como cafeína. Como você informou que usa medicamento para pressão, não consigo avaliar com segurança se esse produto é adequado para você. Consulte seu médico ou nutricionista antes de utilizá-lo.',
    };
  }

  if (mentionsMedication || mentionsPressure) {
    return {
      blocked: true,
      content:
        'Como você mencionou medicamento ou alteração de pressão, não consigo avaliar com segurança se um suplemento é adequado para você. Consulte seu médico ou nutricionista antes de utilizar qualquer produto.',
    };
  }

  if (includesAny(text, pregnancyTerms)) {
    return {
      blocked: true,
      content:
        'Durante a gravidez ou amamentação, a escolha de suplementos deve ser individualizada por um médico ou nutricionista. Não posso recomendar produtos com segurança nesse cenário.',
    };
  }

  if (includesAny(text, minorTerms) || /\b(?:[0-9]|1[0-7])\s*anos?\b/.test(text)) {
    return {
      blocked: true,
      content:
        'Para crianças e adolescentes, suplementos devem ser avaliados por pediatra ou nutricionista. Não posso recomendar produtos com segurança para menores de idade.',
    };
  }

  if ((includesAny(text, diseaseTerms) && !deniesCondition) || includesAny(text, reactionTerms)) {
    return {
      blocked: true,
      content:
        'Como você relatou uma condição de saúde, alergia ou possível reação adversa, não posso indicar suplementos com segurança. Suspenda o uso se houver reação e procure orientação médica ou nutricional.',
    };
  }

  return { blocked: false };
}
