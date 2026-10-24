import { z } from 'zod';
import { nutritionFactsSchema } from '../catalog/productFacts/product-facts.schemas.js';
import type { ConsultantCandidate, OfficialLabelFacts } from './storefrontConsultant.catalog.js';
import {
  isReferentialRequest,
  normalizeSearchText,
  tokenizeSearchText,
} from './storefrontConsultant.search.js';

export type FactIntent =
  | 'usage'
  | 'nutrition'
  | 'ingredients'
  | 'allergens'
  | 'warnings'
  | 'source';

const intentPatterns: ReadonlyArray<readonly [FactIntent, RegExp]> = [
  [
    'usage',
    /\b(?:como usa|como usar|como tomar|como toma|modo de uso|usa|usar|tomar|usage|dose|dosagem|porcao|porcoes|rendimento|serving)\b/,
  ],
  [
    'nutrition',
    /\b(?:tabela nutricional|informacao nutricional|informacoes nutricionais|nutrition facts|nutrition table|nutrient|nutrients|nutriente|nutrientes|valor nutricional)\b/,
  ],
  ['ingredients', /\b(?:ingrediente|ingredientes|composicao)\b/],
  [
    'allergens',
    /\b(?:allergen|allergens|alergeno|alergenos|alergia|alergias|alergico|alergica|(?:contem|possui|tem|sem|nao tem) (?:gluten|lactose))\b/,
  ],
  [
    'warnings',
    /\b(?:warning|warnings|advertencia|advertencias|aviso|avisos|restricao|restricoes|contraindicacao|contraindicacoes)\b/,
  ],
  ['source', /\b(?:source|fonte|origem|fabricante|site oficial|dados oficiais|rotulo oficial)\b/],
];

const warningsSchema = z.array(z.string().trim().min(1)).max(100);

export function detectFactIntents(content: string): FactIntent[] {
  const normalized = normalizeSearchText(content);
  return intentPatterns.flatMap(([intent, pattern]) => (pattern.test(normalized) ? [intent] : []));
}

export function isGenericUsageQuestion(content: string) {
  const supplement = tokenizeSearchText(content).join(' ');
  return [
    'creatina',
    'proteina',
    'cafeina',
    'glutamina',
    'hipercalorico',
    'pre-treino',
    'multivitaminico',
    'colageno',
    'bcaa',
    'albumina',
    'maltodextrina',
    'dextrose',
    'termogenico',
    'melatonina',
    'omega 3',
    'beta alanina',
  ].includes(supplement);
}

type StoredLabel = {
  manufacturer: string | null;
  manufacturerDomain: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceRetrievedAt: Date | null;
  servingSize: string | null;
  servingsPerContainer: string | null;
  usageInstructions: string | null;
  ingredients: string | null;
  allergenStatement: string | null;
  warnings: unknown;
  nutritionFacts: unknown;
  status: string;
  exactProductMatch: boolean;
};

export function publishableLabelFacts(label: StoredLabel | null): OfficialLabelFacts | null {
  if (
    !label ||
    label.status !== 'SOURCE_MATCHED' ||
    !label.exactProductMatch ||
    !label.manufacturerDomain ||
    !label.sourceUrl ||
    !label.sourceRetrievedAt
  ) {
    return null;
  }

  const warnings = label.warnings === null ? null : warningsSchema.safeParse(label.warnings);
  const nutrition =
    label.nutritionFacts === null ? null : nutritionFactsSchema.safeParse(label.nutritionFacts);

  return {
    manufacturer: label.manufacturer,
    manufacturerDomain: label.manufacturerDomain,
    servingSize: label.servingSize,
    servingsPerContainer: label.servingsPerContainer,
    usageInstructions: label.usageInstructions,
    ingredients: label.ingredients,
    allergenStatement: label.allergenStatement,
    warnings: warnings && warnings.success ? warnings.data : null,
    nutritionFacts: nutrition && nutrition.success ? nutrition.data : null,
    source: {
      url: label.sourceUrl,
      title: label.sourceTitle,
      retrievedAt: label.sourceRetrievedAt.toISOString(),
    },
  };
}

export function resolveSingleProductCandidate(
  query: string,
  candidates: ConsultantCandidate[],
): Extract<ConsultantCandidate, { type: 'product' }> | null {
  const normalized = normalizeSearchText(query);
  const selectedIndex = productSelectionIndex(query);
  if (selectedIndex >= 0) {
    const selected = candidates[selectedIndex];
    return selected?.type === 'product' ? selected : null;
  }
  const targetsKit = candidates.some(
    (candidate) =>
      candidate.type === 'kit' &&
      (candidate.contextMatch ||
        normalized.includes(normalizeSearchText(candidate.name)) ||
        normalized.includes(normalizeSearchText(candidate.slug))),
  );
  if (targetsKit) return null;

  const products = candidates.filter(
    (candidate): candidate is Extract<ConsultantCandidate, { type: 'product' }> =>
      candidate.type === 'product',
  );
  const exact = products.filter(
    (product) =>
      normalized.includes(normalizeSearchText(product.name)) ||
      normalized.includes(normalizeSearchText(product.slug)),
  );
  if (exact.length === 1) return exact[0]!;

  if (isReferentialRequest(query) && products.length > 0) {
    const contextual = products.filter((product) => product.contextMatch);
    if (contextual.length === 1) return contextual[0]!;
  }
  return null;
}

export function productSelectionIndex(query: string) {
  const normalized = normalizeSearchText(query);
  const ordinalPatterns = [
    /^(?:1|primeiro|primeira|opcao 1|numero 1)$/,
    /^(?:2|segundo|segunda|opcao 2|numero 2)$/,
    /^(?:3|terceiro|terceira|opcao 3|numero 3)$/,
  ];
  const exactIndex = ordinalPatterns.findIndex((pattern) => pattern.test(normalized));
  if (exactIndex >= 0) return exactIndex;

  return [
    /\b(?:primeiro|primeira|opcao 1|numero 1)\b/,
    /\b(?:segundo|segunda|opcao 2|numero 2)\b/,
    /\b(?:terceiro|terceira|opcao 3|numero 3)\b/,
  ].findIndex((pattern) => pattern.test(normalized));
}

function amountText(amount: NonNullable<OfficialLabelFacts['nutritionFacts']>[number]['amount']) {
  return typeof amount === 'string' ? amount : `${amount.value} ${amount.unit}`;
}

export function formatOfficialFactsResponse(
  product: Extract<ConsultantCandidate, { type: 'product' }>,
  requestedIntents: FactIntent[],
) {
  const facts = product.labelFacts;
  if (!facts) {
    return `Os dados oficiais de rótulo de ${product.name} ainda não estão registrados. Confira o rótulo do produto ou consulte o fabricante.`;
  }

  const intents = new Set(requestedIntents);
  const includeAll = intents.size === 0;
  const lines = [`${product.name}:`];

  if (includeAll || intents.has('usage')) {
    lines.push(`Porção: ${facts.servingSize ?? 'não registrada na fonte.'}`);
    lines.push(
      `Porções por embalagem: ${facts.servingsPerContainer ?? 'não registradas na fonte.'}`,
    );
    lines.push(`Modo de uso: ${facts.usageInstructions ?? 'não registrado na fonte.'}`);
  }
  if (includeAll || intents.has('nutrition')) {
    lines.push('Informação nutricional:');
    if (facts.nutritionFacts?.length) {
      for (const row of facts.nutritionFacts) {
        lines.push(
          `${row.nutrient}: ${amountText(row.amount)} | %VD: ${row.dailyValuePercent === null ? 'não informado' : `${row.dailyValuePercent}%`}`,
        );
      }
    } else {
      lines.push('Tabela nutricional não registrada na fonte.');
    }
  }
  if (includeAll || intents.has('ingredients')) {
    lines.push(`Ingredientes: ${facts.ingredients ?? 'não registrados na fonte.'}`);
  }

  if (includeAll || intents.has('allergens')) {
    lines.push(`Alérgenos: ${facts.allergenStatement ?? 'não registrados na fonte.'}`);
  }
  if (includeAll || intents.has('warnings')) {
    lines.push(
      `Advertências: ${facts.warnings?.length ? facts.warnings.join(' | ') : 'não registradas na fonte.'}`,
    );
  }
  if (includeAll || intents.has('source')) {
    lines.push(`Fonte: ${facts.source.title ?? 'título não informado'}`);
    lines.push(`URL: ${facts.source.url}`);
  }
  return lines.join('\n');
}
