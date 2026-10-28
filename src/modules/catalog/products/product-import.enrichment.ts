import crypto from 'node:crypto';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { redis } from '../../../shared/redis/redis.js';
import { logger } from '../../../shared/logger.js';
import { productImportFamilyKey } from './product-import.utils.js';

type ImportProduct = { sku: string; name: string };
type SearchResult = { title?: unknown; link?: unknown; snippet?: unknown };

const enrichmentSchema = z.object({
  products: z.array(
    z.object({
      familyKey: z.string().min(1),
      description: z.string().trim().min(10).max(500).nullable(),
      primaryCategory: z.string().trim().min(2).max(80).nullable(),
      subtypeCategory: z.string().trim().min(2).max(80).nullable(),
      sourceUrl: z.string().url().nullable(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export type ProductImportEnrichment = z.infer<typeof enrichmentSchema>['products'][number];

async function searchProduct(name: string) {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${name} suplemento fabricante`, gl: 'br', hl: 'pt-br', num: 6 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Pesquisa retornou HTTP ${response.status}.`);
      const data = (await response.json()) as { organic?: SearchResult[] };
      return (data.organic ?? []).flatMap((result) => {
        if (
          typeof result.title !== 'string' ||
          typeof result.link !== 'string' ||
          typeof result.snippet !== 'string'
        )
          return [];
        try {
          const hostname = new URL(result.link).hostname.toLowerCase();
          if (/amazon|facebook|instagram|mercadolivre|shopee|tiktok|youtube/.test(hostname))
            return [];
          return [{ title: result.title, url: result.link, snippet: result.snippet }];
        } catch {
          return [];
        }
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
) {
  const results = Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await work(values[index]!);
      }
    }),
  );
  return results;
}

function cacheKey(familyKey: string) {
  return `catalog:pdf-import:enrichment:v1:${crypto.createHash('sha256').update(familyKey).digest('hex')}`;
}

export async function enrichImportedProducts(
  products: ImportProduct[],
  existingCategories: string[],
) {
  const families = [
    ...new Map(
      products.map((product) => {
        const familyKey = productImportFamilyKey(product.name);
        return [familyKey, { familyKey, representative: product.name }];
      }),
    ).values(),
  ];
  const byFamily = new Map<string, ProductImportEnrichment>();
  const pending: typeof families = [];

  await Promise.all(
    families.map(async (family) => {
      try {
        const cached = await redis.get(cacheKey(family.familyKey));
        if (cached) {
          const parsed = enrichmentSchema.shape.products.element.safeParse(JSON.parse(cached));
          if (parsed.success) byFamily.set(family.familyKey, parsed.data);
          else pending.push(family);
        } else pending.push(family);
      } catch {
        pending.push(family);
      }
    }),
  );

  const researched = await mapConcurrent(pending, 6, async (family) => {
    try {
      return { ...family, sources: await searchProduct(family.representative) };
    } catch (error) {
      logger.warn(
        { err: error, product: family.representative },
        'PDF import product research failed',
      );
      return { ...family, sources: [] };
    }
  });

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    const openai = new OpenAI({ apiKey: openaiKey });
    for (let index = 0; index < researched.length; index += 10) {
      const batch = researched.slice(index, index + 10).filter((item) => item.sources.length > 0);
      if (batch.length === 0) continue;
      try {
        const completion = await openai.chat.completions.parse({
          model: process.env.OPENAI_PRODUCT_FACTS_MODEL?.trim() || 'gpt-4o-mini',
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'Classifique produtos de uma loja brasileira usando exclusivamente os resultados de pesquisa fornecidos. Ignore sabor, marca, peso e embalagem como categorias. primaryCategory é o tipo amplo (ex.: Whey Protein, Creatina, Snacks e Barrinhas, Acessórios); subtypeCategory é o subtipo confirmado (ex.: Whey Concentrado, Whey Isolado, Proteína da Carne). Reutilize exatamente o nome de uma categoria existente quando ela representar o conceito. Crie um nome canônico curto em português somente quando o tipo ou subtipo necessário não existir. Um produto em pó de 900g não é snack por conter Protein, Crush ou Cookies; barra, wafer, cookie e pipoca são snacks somente quando esse for o formato real. Não afirme Sem Lactose sem evidência explícita. A descrição deve ser factual e sustentada pelos trechos. sourceUrl deve apontar para a fonte usada. Se as fontes não identificarem o produto, use campos nulos e confidence=low.',
            },
            {
              role: 'user',
              content: JSON.stringify({ existingCategories, products: batch }),
            },
          ],
          response_format: zodResponseFormat(enrichmentSchema, 'pdf_product_enrichment'),
        });
        for (const enrichment of completion.choices[0]?.message.parsed?.products ?? []) {
          if (!batch.some((item) => item.familyKey === enrichment.familyKey)) continue;
          byFamily.set(enrichment.familyKey, enrichment);
          if (enrichment.confidence !== 'low') {
            await redis
              .set(
                cacheKey(enrichment.familyKey),
                JSON.stringify(enrichment),
                'EX',
                30 * 24 * 60 * 60,
              )
              .catch(() => undefined);
          }
        }
      } catch (error) {
        logger.warn({ err: error }, 'PDF import product classification failed');
      }
    }
  }

  return new Map(
    products.map((product) => [
      product.sku,
      byFamily.get(productImportFamilyKey(product.name)) ?? null,
    ]),
  );
}
