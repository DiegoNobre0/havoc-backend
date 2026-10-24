import crypto from 'node:crypto';
import axios from 'axios';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { fetchOfficialSource } from '../catalog/productFacts/product-facts.service.js';
import { logger } from '../../shared/logger.js';
import { normalizeSearchText } from './storefrontConsultant.search.js';

const TRUSTED_DOMAINS = [
  'anvisa.gov.br',
  'gov.br',
  'nih.gov',
  'ncbi.nlm.nih.gov',
  'who.int',
  'mayoclinic.org',
  'jissn.biomedcentral.com',
] as const;
const TRUSTED_RETAIL_DOMAINS = [
  'banca13.com.br',
  'drogaraia.com.br',
  'drogasil.com.br',
  'drogariasaopaulo.com.br',
  'mundoverde.com.br',
  'paguemenos.com.br',
  'panvel.com',
] as const;
const RESEARCH_CACHE_SECONDS = 6 * 60 * 60;

const researchResponseSchema = z.object({
  content: z.string().trim().min(20).max(320),
  usedSourceNumbers: z.array(z.number().int().min(1).max(3)).min(1).max(3),
});
const cachedResearchSchema = z.object({
  content: z.string().trim().min(20).max(320),
  sources: z
    .array(z.object({ title: z.string(), url: z.string().url() }))
    .min(1)
    .max(3),
});
const productUsageSchema = z.object({
  exactProductMatch: z.boolean(),
  sourceNumber: z.number().int().min(1).max(5).nullable(),
  usageEvidence: z.string().trim().min(10).max(500).nullable(),
});
const cachedProductUsageSchema = z.object({
  evidence: z.string().trim().min(10).max(500),
  source: z.object({ title: z.string().trim().min(1), url: z.string().url() }),
});
const productProfileExtractionSchema = z.object({
  exactProductMatch: z.boolean(),
  sourceNumber: z.number().int().min(1).max(5).nullable(),
  ingredientsEvidence: z.string().trim().min(3).max(2000).nullable(),
  warningsEvidence: z.string().trim().min(3).max(2000).nullable(),
  usageEvidence: z.string().trim().min(3).max(1000).nullable(),
  stimulant: z.enum(['present', 'absent', 'unknown']),
  stimulantEvidence: z.string().trim().min(3).max(500).nullable(),
  lactose: z.enum(['present', 'absent', 'unknown']),
  lactoseEvidence: z.string().trim().min(3).max(500).nullable(),
});
const cachedProductProfileSchema = productProfileExtractionSchema
  .omit({
    exactProductMatch: true,
    sourceNumber: true,
  })
  .extend({
    source: z.object({ title: z.string().trim().min(1), url: z.string().url() }),
  });

type SearchResult = { title?: unknown; link?: unknown; snippet?: unknown };
type ResearchSource = { title: string; url: string; domain: string; text: string };
type ResearchAnswer = z.infer<typeof cachedResearchSchema>;
export type ResearchedProductProfile = z.infer<typeof cachedProductProfileSchema>;

function normalizeEvidenceText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('pt-BR')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}%#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productSearchRelevance(title: string, productName: string) {
  const normalizedTitle = normalizeSearchText(title);
  const tokens = normalizeSearchText(productName)
    .split(' ')
    .filter((token) => token.length > 2 && !/^(?:caps|capsulas|comprimidos|tabs)$/.test(token));
  const matchingTokens = tokens.filter((token) => normalizedTitle.includes(token)).length;
  const productPrefix = tokens.slice(0, 2).join(' ');
  return (
    matchingTokens * 2 +
    (productPrefix && normalizedTitle.startsWith(productPrefix) ? 6 : 0) -
    (/\bkit\b/.test(normalizedTitle) ? 8 : 0)
  );
}

function focusProductSource(text: string, title: string) {
  const productStart = text
    .toLocaleLowerCase('pt-BR')
    .lastIndexOf(title.toLocaleLowerCase('pt-BR'));
  return productStart > 0 ? text.slice(productStart) : text;
}

export function shouldResearchGeneralQuestion(content: string) {
  const text = normalizeSearchText(content);
  return [
    /\bo que e\b/,
    /\bpara que serve\b/,
    /\bbeneficios?\b/,
    /\bevidencias?\b/,
    /\bestudos?\b/,
    /\bqual a diferenca\b/,
    /\bdiferenca entre\b/,
    /\bcomo (?:e que )?funciona\b/,
    /\befeitos?\b/,
    /\bfaz mal\b/,
    /\be seguro\b/,
    /\b(?:posso|pode) tomar\b/,
    /\bmelhor horario\b/,
    /\bquanto tempo\b/,
    /\bcausa\b/,
    /\briscos?\b/,
    /\bpode misturar\b/,
    /\bvale a pena\b/,
    /\b(?:tem|contem|possui|sem|nao tem) (?:lactose|gluten|cafeina)\b/,
  ].some((pattern) => pattern.test(text));
}

export function normalizeGeneralResearchQuery(content: string) {
  return content.replace(
    /\b(?:3\s*way|three\s+way|3\s+whey|three\s+whey)\b/gi,
    'whey protein blend (3 whey), tipos concentrado, isolado e hidrolisado',
  );
}

export function trustedResearchDomain(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return (
    TRUSTED_DOMAINS.find((domain) => normalized === domain || normalized.endsWith(`.${domain}`)) ??
    null
  );
}

export function trustedRetailDomain(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return (
    TRUSTED_RETAIL_DOMAINS.find(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    ) ?? null
  );
}

export function wantsResearchSources(content: string) {
  return /\b(?:fonte|fontes|estudo|estudos|evidencia|evidencias|referencia|referencias|link|links)\b/.test(
    normalizeSearchText(content),
  );
}

export function conciseCommonUsageAnswer(content: string) {
  const text = normalizeSearchText(content);
  if (
    /\bcreatina\b/.test(text) &&
    /(?:\bcomo\b.{0,24}\b(?:usa|usar|toma|tomar)\b|\b(?:dose|dosagem)\b)/.test(text)
  ) {
    return 'Uso geral da creatina monohidratada: 3 a 5 g por dia, todos os dias. Misture em água ou outra bebida; o horário não é essencial. Para uma marca específica, me diga qual para conferir o dosador.';
  }
  return null;
}

async function searchTrustedSources(query: string): Promise<ResearchSource[]> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];
  const siteQuery = TRUSTED_DOMAINS.map((domain) => `site:${domain}`).join(' OR ');
  const response = await axios.post<{ organic?: SearchResult[] }>(
    'https://google.serper.dev/search',
    { q: `${query} suplementos evidências (${siteQuery})`, num: 10 },
    { timeout: 10_000, headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } },
  );
  const candidates = (response.data.organic ?? []).flatMap((result) => {
    if (typeof result.link !== 'string' || typeof result.title !== 'string') return [];
    try {
      const url = new URL(result.link);
      const domain = trustedResearchDomain(url.hostname);
      if (!domain || !['http:', 'https:'].includes(url.protocol)) return [];
      return [{ title: result.title.trim(), url: url.toString(), domain }];
    } catch {
      return [];
    }
  });

  const unique = [
    ...new Map(candidates.map((candidate) => [candidate.url, candidate])).values(),
  ].slice(0, 5);
  const fetched = await Promise.allSettled(
    unique.map(async (candidate) => {
      const source = await fetchOfficialSource(candidate.url, candidate.domain);
      return { ...candidate, url: source.url, text: source.text.slice(0, 18_000) };
    }),
  );
  return fetched
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .slice(0, 3);
}

function cacheKey(query: string) {
  return `storefront:consultant:research:v3:${crypto
    .createHash('sha256')
    .update(normalizeSearchText(query))
    .digest('hex')}`;
}

function formatResearchAnswer(answer: ResearchAnswer, includeSources: boolean, query: string) {
  const content = conciseCommonUsageAnswer(query) ?? answer.content;
  if (!includeSources) return content;
  return [
    content,
    '',
    'Fontes:',
    ...answer.sources.map((source) => `${source.title}: ${source.url}`),
  ].join('\n');
}

export async function researchGeneralQuestion(
  query: string,
  options: { includeSources?: boolean } = {},
): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey || !process.env.SERPER_API_KEY?.trim()) return null;
  const includeSources = options.includeSources ?? wantsResearchSources(query);
  const key = cacheKey(query);
  const researchQuery = normalizeGeneralResearchQuery(query);
  try {
    const { redis } = await import('../../shared/redis/redis.js');
    const cached = await redis.get(key);
    if (cached) {
      const parsed = cachedResearchSchema.safeParse(JSON.parse(cached));
      if (parsed.success) return formatResearchAnswer(parsed.data, includeSources, query);
    }
  } catch (error) {
    logger.warn({ err: error }, 'Consultant research cache read failed');
  }

  try {
    const sources = await searchTrustedSources(researchQuery);
    if (sources.length === 0) return null;
    const openai = new OpenAI({ apiKey: openaiKey });
    const completion = await openai.chat.completions.parse({
      model: process.env.OPENAI_CONSULTANT_MODEL?.trim() || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Responda em pt-BR usando exclusivamente os textos fornecidos e somente o que foi perguntado, em no máximo 2 frases e 320 caracteres. Se perguntarem como usar ou qual a dose, a primeira frase DEVE começar pela quantidade e frequência geral sustentadas pelas fontes; a segunda pode informar preparo e horário. Nesse caso, NÃO explique o que é o suplemento, benefícios, desempenho, qualidade do produto, história, conclusão ou alertas genéricos. Não inclua fontes nem citações como [1]. Diferencie orientação geral da porção de uma marca específica. Não prescreva dose individual, não diagnostique nem avalie interação medicamentosa. Se as fontes não sustentarem a resposta, diga isso em uma frase curta.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: query,
            sources: sources.map((source, index) => ({
              number: index + 1,
              title: source.title,
              url: source.url,
              text: source.text,
            })),
          }),
        },
      ],
      response_format: zodResponseFormat(researchResponseSchema, 'research_answer'),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) return null;
    const used = [...new Set(parsed.usedSourceNumbers)]
      .map((number) => ({ number, source: sources[number - 1] }))
      .filter((entry): entry is { number: number; source: ResearchSource } =>
        Boolean(entry.source),
      );
    if (used.length === 0) return null;
    const answer: ResearchAnswer = {
      content:
        conciseCommonUsageAnswer(query) ??
        parsed.content
          .replace(/<[^>]*>/g, '')
          .replace(/\s*\[\d+\]/g, '')
          .trim(),
      sources: used.map(({ source }) => ({ title: source.title, url: source.url })),
    };
    try {
      const { redis } = await import('../../shared/redis/redis.js');
      await redis.set(key, JSON.stringify(answer), 'EX', RESEARCH_CACHE_SECONDS);
    } catch (error) {
      logger.warn({ err: error }, 'Consultant research cache write failed');
    }
    return formatResearchAnswer(answer, includeSources, query);
  } catch (error) {
    logger.warn({ err: error }, 'Consultant trusted web research failed');
    return null;
  }
}

export async function researchExactProductUsage(
  productName: string,
  options: { includeSources?: boolean } = {},
): Promise<string | null> {
  const serperKey = process.env.SERPER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!serperKey || !openaiKey) return null;
  const key = `storefront:consultant:product-usage:v1:${crypto
    .createHash('sha256')
    .update(normalizeSearchText(productName))
    .digest('hex')}`;
  const formatUsage = (value: z.infer<typeof cachedProductUsageSchema>) => {
    const content = value.evidence;
    return options.includeSources
      ? `${content}\n\nFonte secundária: ${value.source.title}: ${value.source.url}`
      : content;
  };

  try {
    const { redis } = await import('../../shared/redis/redis.js');
    const cached = await redis.get(key);
    if (cached) {
      const parsed = cachedProductUsageSchema.safeParse(JSON.parse(cached));
      if (parsed.success) return formatUsage(parsed.data);
    }
  } catch (error) {
    logger.warn({ err: error }, 'Consultant product usage cache read failed');
  }

  try {
    const siteQuery = TRUSTED_RETAIL_DOMAINS.map((domain) => `site:${domain}`).join(' OR ');
    const response = await axios.post<{ organic?: SearchResult[] }>(
      'https://google.serper.dev/search',
      {
        q: `${productName} modo de uso sugestão de uso consumir (${siteQuery})`,
        num: 10,
      },
      {
        timeout: 10_000,
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      },
    );
    const candidates = (response.data.organic ?? []).flatMap((result) => {
      if (typeof result.link !== 'string' || typeof result.title !== 'string') return [];
      try {
        const url = new URL(result.link);
        const domain = trustedRetailDomain(url.hostname);
        if (!domain || !['http:', 'https:'].includes(url.protocol)) return [];
        return [{ title: result.title.trim(), url: url.toString(), domain }];
      } catch {
        return [];
      }
    });
    const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
      .sort(
        (left, right) =>
          productSearchRelevance(right.title, productName) -
          productSearchRelevance(left.title, productName),
      )
      .slice(0, 5);
    const fetched = await Promise.allSettled(
      unique.map(async (candidate) => {
        const source = await fetchOfficialSource(candidate.url, candidate.domain);
        return {
          ...candidate,
          url: source.url,
          text: focusProductSource(source.text, candidate.title).slice(0, 24_000),
        };
      }),
    );
    const sources = fetched.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    if (sources.length === 0) return null;

    const openai = new OpenAI({ apiKey: openaiKey });
    const completion = await openai.chat.completions.parse({
      model: process.env.OPENAI_PRODUCT_FACTS_MODEL?.trim() || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Identifique uma instrução de uso somente quando a fonte corresponder ao produto exato, incluindo marca e quantidade da embalagem. A fonte é secundária e pode ser uma loja. Copie em usageEvidence um único trecho literal que informe quantidade e frequência. Não resuma, converta, complete ou combine fontes. Se não houver correspondência e instrução inequívocas, retorne exactProductMatch=false e os demais campos nulos.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            productName,
            sources: sources.map((source, index) => ({
              number: index + 1,
              title: source.title,
              url: source.url,
              text: source.text,
            })),
          }),
        },
      ],
      response_format: zodResponseFormat(productUsageSchema, 'secondary_product_usage'),
    });
    const parsed = completion.choices[0]?.message.parsed;
    const source = parsed?.sourceNumber ? sources[parsed.sourceNumber - 1] : null;
    const evidence = parsed?.usageEvidence?.replace(/\s+/g, ' ').trim();
    if (
      !parsed?.exactProductMatch ||
      !source ||
      !evidence ||
      !source.text
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('pt-BR')
        .includes(evidence.toLocaleLowerCase('pt-BR'))
    ) {
      return null;
    }

    const answer = { evidence, source: { title: source.title, url: source.url } };
    try {
      const { redis } = await import('../../shared/redis/redis.js');
      await redis.set(key, JSON.stringify(answer), 'EX', RESEARCH_CACHE_SECONDS);
    } catch (error) {
      logger.warn({ err: error }, 'Consultant product usage cache write failed');
    }
    return formatUsage(answer);
  } catch (error) {
    logger.warn({ err: error }, 'Consultant exact-product retail research failed');
    return null;
  }
}

export async function researchExactProductProfile(
  productName: string,
): Promise<ResearchedProductProfile | null> {
  const serperKey = process.env.SERPER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!serperKey || !openaiKey) return null;
  const key = `storefront:consultant:product-profile:v3:${crypto
    .createHash('sha256')
    .update(normalizeSearchText(productName))
    .digest('hex')}`;

  try {
    const { redis } = await import('../../shared/redis/redis.js');
    const cached = await redis.get(key);
    if (cached) {
      const parsed = cachedProductProfileSchema.safeParse(JSON.parse(cached));
      if (parsed.success) return parsed.data;
    }
  } catch (error) {
    logger.warn({ err: error }, 'Consultant product profile cache read failed');
  }

  try {
    const siteQuery = TRUSTED_RETAIL_DOMAINS.map((domain) => `site:${domain}`).join(' OR ');
    const response = await axios.post<{ organic?: SearchResult[] }>(
      'https://google.serper.dev/search',
      {
        q: `${productName} (${siteQuery})`,
        num: 10,
      },
      {
        timeout: 10_000,
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      },
    );
    const candidates = (response.data.organic ?? []).flatMap((result) => {
      if (typeof result.link !== 'string' || typeof result.title !== 'string') return [];
      try {
        const url = new URL(result.link);
        const domain = trustedRetailDomain(url.hostname);
        if (!domain || !['http:', 'https:'].includes(url.protocol)) return [];
        return [{ title: result.title.trim(), url: url.toString(), domain }];
      } catch {
        return [];
      }
    });
    const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
      .sort(
        (left, right) =>
          productSearchRelevance(right.title, productName) -
          productSearchRelevance(left.title, productName),
      )
      .slice(0, 5);
    const fetched = await Promise.allSettled(
      unique.map(async (candidate) => {
        const source = await fetchOfficialSource(candidate.url, candidate.domain);
        return {
          ...candidate,
          url: source.url,
          text: focusProductSource(source.text, candidate.title).slice(0, 30_000),
        };
      }),
    );
    const sources = fetched.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    if (sources.length === 0) return null;

    const openai = new OpenAI({ apiKey: openaiKey });
    const completion = await openai.chat.completions.parse({
      model: process.env.OPENAI_PRODUCT_FACTS_MODEL?.trim() || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Extraia dados somente se uma fonte corresponder exatamente ao produto pedido, incluindo marca, variante e quantidade da embalagem. Cada campo Evidence deve ser um único trecho literal da mesma fonte. Não resuma, traduza, combine fontes nem use conhecimento próprio. stimulant=present exige trecho que declare cafeína ou outro estimulante; absent exige declaração explícita de ausência/sem cafeína; caso contrário use unknown. Faça o mesmo para lactose. Se não houver produto exato ou nenhum dado útil, retorne exactProductMatch=false.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            productName,
            sources: sources.map((source, index) => ({
              number: index + 1,
              title: source.title,
              url: source.url,
              text: source.text,
            })),
          }),
        },
      ],
      response_format: zodResponseFormat(productProfileExtractionSchema, 'product_profile'),
    });
    const parsed = completion.choices[0]?.message.parsed;
    const source = parsed?.sourceNumber ? sources[parsed.sourceNumber - 1] : null;
    if (!parsed?.exactProductMatch || !source) return null;
    const sourceText = normalizeEvidenceText(source.text);
    const validatedEvidence = (value: string | null) =>
      value && sourceText.includes(normalizeEvidenceText(value)) ? value : null;
    const ingredientsEvidence = validatedEvidence(parsed.ingredientsEvidence);
    const warningsEvidence = validatedEvidence(parsed.warningsEvidence);
    const usageEvidence = validatedEvidence(parsed.usageEvidence);
    const rawStimulantEvidence = validatedEvidence(parsed.stimulantEvidence);
    const stimulantEvidence =
      rawStimulantEvidence &&
      /\b(?:cafeina|guarana|estimulante|sinefrina|taurina)\b/.test(
        normalizeSearchText(rawStimulantEvidence),
      )
        ? rawStimulantEvidence
        : null;
    const rawLactoseEvidence = validatedEvidence(parsed.lactoseEvidence);
    const lactoseEvidence =
      rawLactoseEvidence && /\blactose\b/.test(normalizeSearchText(rawLactoseEvidence))
        ? rawLactoseEvidence
        : null;
    if (
      !ingredientsEvidence &&
      !warningsEvidence &&
      !usageEvidence &&
      !stimulantEvidence &&
      !lactoseEvidence
    )
      return null;

    const profile: ResearchedProductProfile = {
      ingredientsEvidence,
      warningsEvidence,
      usageEvidence,
      stimulant: stimulantEvidence ? parsed.stimulant : 'unknown',
      stimulantEvidence,
      lactose: lactoseEvidence ? parsed.lactose : 'unknown',
      lactoseEvidence,
      source: { title: source.title, url: source.url },
    };
    try {
      const { redis } = await import('../../shared/redis/redis.js');
      await redis.set(key, JSON.stringify(profile), 'EX', RESEARCH_CACHE_SECONDS);
    } catch (error) {
      logger.warn({ err: error }, 'Consultant product profile cache write failed');
    }
    return profile;
  } catch (error) {
    logger.warn({ err: error }, 'Consultant product profile research failed');
    return null;
  }
}
