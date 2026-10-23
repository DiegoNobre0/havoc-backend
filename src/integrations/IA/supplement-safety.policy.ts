export interface SupplementSafetyResult {
  blocked: boolean;
  response?: string;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function evaluateSupplementSafety(message: string): SupplementSafetyResult {
  const normalized = normalize(message);

  const emergencySignals = [
    'falta de ar',
    'dor no peito',
    'desmaio',
    'convulsao',
    'anafilax',
    'garganta fechando',
    'rosto inchado',
    'lingua inchada',
    'overdose',
  ];

  if (containsAny(normalized, emergencySignals)) {
    return {
      blocked: true,
      response:
        'Isso pode ser uma emergência. Procure atendimento médico imediato ou ligue para o SAMU (192). Não use suplementos para tentar tratar esses sintomas.',
    };
  }

  const medicationSignals = [
    'medicamento',
    'remedio',
    'medicacao',
    'medicado',
    'losartana',
    'enalapril',
    'atenolol',
    'amlodipina',
    'captopril',
    'hidroclorotiazida',
  ];
  const pressureSignals = ['pressao alta', 'hipertens', 'pressao arterial'];
  const riskSignals = [
    ...medicationSignals,
    ...pressureSignals,
    'gravida',
    'gravidez',
    'gestante',
    'amament',
    'lactante',
    'menor de idade',
    'crianca',
    'adolescente',
    'doenca',
    'diabetes',
    'cardiaco',
    'cardiaca',
    'renal',
    'figado',
    'alergia',
    'alergico',
    'alergica',
    'intoleran',
    'reacao adversa',
    'efeito colateral',
    'passando mal',
  ];

  const minorAge = /\b(?:tenho\s+)?(?:[0-9]|1[0-7])\s*anos\b/.test(normalized);
  const hasRisk = containsAny(normalized, riskSignals) || minorAge;

  if (!hasRisk) {
    const transactionSignals = [
      'meu cpf',
      'meu endereco',
      'meu cep',
      'calcular frete',
      'valor do frete',
      'finalizar pedido',
      'fechar pedido',
      'gerar pix',
      'chave pix',
      'checkout',
      'numero do cartao',
      'dados do cartao',
    ];

    if (containsAny(normalized, transactionSignals)) {
      return {
        blocked: true,
        response:
          'Não realizo pedidos, pagamentos ou cálculo de frete pelo WhatsApp e não posso coletar dados pessoais. Para comprar, acesse a página do produto ou kit e conclua pelo checkout da loja online.',
      };
    }

    return { blocked: false };
  }

  const mentionsStimulant = containsAny(normalized, [
    'termogenic',
    'cafeina',
    'pre treino',
    'pre-treino',
    'estimulante',
  ]);
  const mentionsPressureMedication =
    containsAny(normalized, pressureSignals) && containsAny(normalized, medicationSignals);

  if (mentionsStimulant && mentionsPressureMedication) {
    return {
      blocked: true,
      response:
        'Termogênicos podem conter estimulantes como cafeína. Como você informou que usa medicamento para pressão, não consigo avaliar com segurança se esse produto é adequado para você. Consulte seu médico ou nutricionista antes de utilizá-lo.',
    };
  }

  return {
    blocked: true,
    response:
      'Como você informou uma condição que exige cuidado, não consigo avaliar com segurança se um suplemento é adequado para você nem recomendar produtos. Consulte seu médico ou nutricionista antes de utilizar qualquer suplemento.',
  };
}
