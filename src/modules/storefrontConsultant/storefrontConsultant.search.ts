export type CatalogSearchDocument = {
  type: 'product' | 'kit';
  id: string;
  slug: string;
  name: string;
  available: boolean;
  categories: string[];
  itemNames?: string[];
};

export type CatalogSearchContext = {
  type: 'product' | 'kit';
  id: string;
  slug: string;
};

export type ScoredCatalogDocument<T extends CatalogSearchDocument = CatalogSearchDocument> = {
  document: T;
  score: number;
  correctedTokens: string[];
};

const STOPWORDS = new Set([
  'a',
  'ao',
  'as',
  'como',
  'com',
  'da',
  'das',
  'de',
  'dados',
  'dose',
  'dosagem',
  'do',
  'dos',
  'e',
  'em',
  'eu',
  'facts',
  'fabricante',
  'fonte',
  'ingrediente',
  'ingredientes',
  'composicao',
  'me',
  'modo',
  'o',
  'os',
  'ou',
  'oficiais',
  'oficial',
  'para',
  'por',
  'porcao',
  'porcoes',
  'posso',
  'pode',
  'poderia',
  'preciso',
  'produto',
  'produtos',
  'qual',
  'que',
  'queria',
  'quero',
  'saber',
  'suplemento',
  'suplementos',
  'tem',
  'tabela',
  'table',
  'nutricional',
  'nutrition',
  'nutriente',
  'nutrientes',
  'oi',
  'ola',
  'advertencia',
  'advertencias',
  'aviso',
  'avisos',
  'warning',
  'warnings',
  'alergeno',
  'alergenos',
  'toma',
  'tomar',
  'uma',
  'umas',
  'um',
  'uns',
  'usa',
  'usar',
  'uso',
  'utiliza',
  'utilizar',
  'voces',
]);

const ALIAS_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['creatina', ['creatina', 'creatine']],
  ['proteina', ['proteina', 'protein', 'whey']],
  ['pre treino', ['pre treino', 'pre workout']],
  ['hipercalorico', ['hipercalorico', 'mass gainer']],
  ['termogenico', ['termogenico', 'thermogenic']],
  ['colageno', ['colageno', 'collagen']],
  ['glutamina', ['glutamina', 'glutamine']],
];

const REFERENTIAL_PATTERNS = [
  /\b(?:esse|essa|esses|essas|este|esta|estes|estas|ele|ela|dele|dela|deles|delas|deste|desta|desse|dessa|desses|dessas)\b/,
  /\b(?:este|esse|esta|essa) produto\b/,
  /\bcomo (?:(?:eu )?(?:posso|devo|deveria|poderia) )?(?:usa|usar|utiliza|utilizar|toma|tomar)\b/,
  /\b(?:tabela|rotulo|composicao|ingredientes) (?:dele|dela|desse|dessa)\b/,
  /\bqual (?:deles|delas|e o melhor|e melhor)\b/,
  /\b(?:o|a) (?:primeiro|primeira|segundo|segunda|terceiro|terceira)\b/,
  /^(?:1|2|3)$/,
];

const aliasToCanonical = new Map<string, string>();
for (const [canonical, aliases] of ALIAS_GROUPS) {
  for (const alias of aliases) aliasToCanonical.set(alias, canonical);
}

export function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function rawTokens(value: string) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(' ') : [];
}

function canonicalize(tokens: string[]) {
  const canonical: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const pair = tokens[index + 1] ? `${tokens[index]} ${tokens[index + 1]}` : '';
    const pairAlias = aliasToCanonical.get(pair);
    if (pairAlias) {
      canonical.push(pairAlias.replace(' ', '-'));
      index += 1;
      continue;
    }
    canonical.push((aliasToCanonical.get(tokens[index]!) ?? tokens[index]!).replace(' ', '-'));
  }
  return canonical;
}

export function tokenizeSearchText(value: string) {
  return canonicalize(rawTokens(value).filter((token) => !STOPWORDS.has(token)));
}

export function isReferentialRequest(value: string) {
  const normalized = normalizeSearchText(value);
  return REFERENTIAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function damerauLevenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let row = 0; row <= left.length; row += 1) matrix[row]![0] = row;
  for (let column = 0; column <= right.length; column += 1) matrix[0]![column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row]![column] = Math.min(
          matrix[row]![column]!,
          matrix[row - 2]![column - 2]! + cost,
        );
      }
    }
  }
  return matrix[left.length]![right.length]!;
}

function correctionVocabulary(documents: CatalogSearchDocument[]) {
  const vocabulary = new Set<string>();
  for (const [, aliases] of ALIAS_GROUPS) {
    for (const alias of aliases) rawTokens(alias).forEach((token) => vocabulary.add(token));
  }
  for (const document of documents) {
    [document.name, document.slug, ...document.categories, ...(document.itemNames ?? [])]
      .flatMap(rawTokens)
      .filter((token) => token.length >= 5)
      .forEach((token) => vocabulary.add(token));
  }
  return [...vocabulary].sort();
}

export function correctSearchTokens(tokens: string[], vocabulary: string[]) {
  return tokens.map((token) => {
    if (token.length < 5 || vocabulary.includes(token)) return token;
    const maximumDistance = token.length >= 8 ? 2 : 1;
    let correction = token;
    let bestDistance = maximumDistance + 1;
    for (const candidate of vocabulary) {
      if (Math.abs(candidate.length - token.length) > maximumDistance) continue;
      const distance = damerauLevenshteinDistance(token, candidate);
      if (distance < bestDistance) {
        correction = candidate;
        bestDistance = distance;
      }
    }
    return correction;
  });
}

function documentFields(document: CatalogSearchDocument) {
  return {
    name: new Set(tokenizeSearchText(document.name)),
    slug: new Set(tokenizeSearchText(document.slug)),
    categories: new Set(document.categories.flatMap(tokenizeSearchText)),
    items: new Set((document.itemNames ?? []).flatMap(tokenizeSearchText)),
  };
}

export function searchCatalog<T extends CatalogSearchDocument>(
  query: string,
  documents: T[],
  context?: CatalogSearchContext,
): ScoredCatalogDocument<T>[] {
  const queryTokens = [...new Set(rawTokens(query).filter((token) => !STOPWORDS.has(token)))].slice(
    0,
    12,
  );
  const corrected = correctSearchTokens(queryTokens, correctionVocabulary(documents));
  const correctedTokens = [...new Set(canonicalize(corrected))];
  const referential = isReferentialRequest(query);

  const scored = documents.flatMap((document) => {
    const fields = documentFields(document);
    let matched = 0;
    let score = 0;
    for (const token of correctedTokens) {
      let tokenScore = 0;
      if (fields.name.has(token)) tokenScore = 30;
      else if (fields.slug.has(token)) tokenScore = 28;
      else if (fields.categories.has(token)) tokenScore = 24;
      else if (fields.items.has(token)) tokenScore = 20;
      if (tokenScore > 0) {
        matched += 1;
        score += tokenScore;
      }
    }

    const isContext =
      referential &&
      context?.type === document.type &&
      context.id === document.id &&
      normalizeSearchText(context.slug) === normalizeSearchText(document.slug);
    if (isContext) score += 100;

    const coverage = correctedTokens.length === 0 ? 0 : matched / correctedTokens.length;
    if (!isContext && (score < 20 || coverage < 0.5)) return [];
    return [{ document, score, correctedTokens }];
  });

  return scored
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.document.available !== left.document.available)
        return Number(right.document.available) - Number(left.document.available);
      const leftName = normalizeSearchText(left.document.name);
      const rightName = normalizeSearchText(right.document.name);
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      return left.document.id < right.document.id
        ? -1
        : left.document.id === right.document.id
          ? 0
          : 1;
    })
    .slice(0, 8);
}
