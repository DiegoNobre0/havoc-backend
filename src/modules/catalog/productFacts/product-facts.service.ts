import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import axios from 'axios';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { PDFParse } from 'pdf-parse';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../database/prisma.js';
import { AppError } from '../../../shared/errors/AppError.js';
import {
  hostnameMatchesDomain,
  manufacturerDomainSchema,
  manufacturerSourceUrlSchema,
  productFactsExtractionSchema,
  validateLiteralExtraction,
  type SyncProductLabelInput,
} from './product-facts.schemas.js';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_TEXT = 100_000;
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain', 'application/pdf'];

export function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:')
    );
  }
  return true;
}

export function validateManufacturerSourceUrl(value: string, manufacturerDomain: string) {
  const sourceUrl = manufacturerSourceUrlSchema.parse(value);
  const url = new URL(sourceUrl);
  if (!hostnameMatchesDomain(url.hostname, manufacturerDomain)) {
    throw new AppError('A URL deve pertencer ao domínio oficial do fabricante.', 400);
  }
  return url;
}

async function assertPublicDestination(hostname: string) {
  if (net.isIP(hostname) || hostname.toLowerCase() === 'localhost') {
    throw new AppError('Destino de rede não permitido.', 400);
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError('Não foi possível resolver o domínio do fabricante.', 422);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AppError('O domínio do fabricante resolve para uma rede não permitida.', 400);
  }
}

function htmlToText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeSourceBuffer(buffer: Buffer, contentTypeHeader: string) {
  const headerCharset = contentTypeHeader.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  const htmlCharset = buffer
    .subarray(0, Math.min(buffer.byteLength, 4096))
    .toString('latin1')
    .match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1];
  const charset = (headerCharset ?? htmlCharset ?? 'utf-8').toLowerCase();
  const encoding = /^(?:iso-8859-1|latin1|windows-1252|cp1252)$/.test(charset)
    ? 'windows-1252'
    : 'utf-8';
  const decoded = new TextDecoder(encoding).decode(buffer);

  // Some legacy storefronts omit their Windows-1252 charset declaration.
  return encoding === 'utf-8' && decoded.includes('\uFFFD')
    ? new TextDecoder('windows-1252').decode(buffer)
    : decoded;
}

export async function fetchOfficialSource(initialUrl: string, domain: string) {
  let url = validateManufacturerSourceUrl(initialUrl, domain);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicDestination(url.hostname);
    const response = await axios.get<ArrayBuffer>(url.toString(), {
      responseType: 'arraybuffer',
      timeout: 10_000,
      maxContentLength: MAX_SOURCE_BYTES,
      maxBodyLength: MAX_SOURCE_BYTES,
      maxRedirects: 0,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || (status >= 300 && status < 400),
      headers: { 'User-Agent': 'HavocProductLabelSync/1.0' },
    });

    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location || redirects === 3)
        throw new AppError('Redirecionamento inválido na fonte.', 422);
      url = validateManufacturerSourceUrl(new URL(location, url).toString(), domain);
      continue;
    }

    const contentTypeHeader = String(response.headers['content-type'] ?? '');
    const contentType = contentTypeHeader.split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new AppError('Tipo de conteúdo da fonte não permitido.', 422);
    }
    const buffer = Buffer.from(response.data);
    if (buffer.byteLength > MAX_SOURCE_BYTES)
      throw new AppError('Fonte excede o limite de tamanho.', 422);

    let text: string;
    if (contentType === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else {
      const decoded = decodeSourceBuffer(buffer, contentTypeHeader);
      text = contentType === 'text/html' ? htmlToText(decoded) : decoded;
    }
    text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_TEXT);
    if (!text) throw new AppError('A fonte oficial não contém texto extraível.', 422);
    return { url: url.toString(), buffer, text };
  }
  throw new AppError('Não foi possível obter a fonte oficial.', 422);
}

type SerperResult = { link?: unknown; title?: unknown; snippet?: unknown };

const officialIdentitySchema = z.object({
  source: z
    .object({
      manufacturer: z.string().trim().min(2),
      sourceUrl: z.string().trim().min(1),
    })
    .strict()
    .nullable(),
});

const NON_OFFICIAL_HOSTS = [
  'amazon.',
  'facebook.com',
  'google.',
  'instagram.com',
  'magazineluiza.com.br',
  'mercadolivre.com.br',
  'shopee.',
  'tiktok.com',
  'youtube.com',
];

export async function discoverOfficialIdentity(productName: string) {
  const serperKey = process.env.SERPER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!serperKey || !openaiKey) {
    throw new AppError('As chaves de pesquisa oficial não estão configuradas.', 503);
  }

  const response = await axios.post<{ organic?: SerperResult[] }>(
    'https://google.serper.dev/search',
    { q: `${productName} fabricante site oficial`, num: 10 },
    {
      timeout: 10_000,
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
    },
  );
  const results = (response.data.organic ?? []).flatMap((result) => {
    if (
      typeof result.link !== 'string' ||
      typeof result.title !== 'string' ||
      typeof result.snippet !== 'string'
    ) {
      return [];
    }
    try {
      const url = new URL(result.link);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      const hostname = url.hostname.toLowerCase();
      if (NON_OFFICIAL_HOSTS.some((blocked) => hostname.includes(blocked))) return [];
      return [{ link: url.toString(), title: result.title, snippet: result.snippet }];
    } catch {
      return [];
    }
  });
  if (results.length === 0) return null;

  const productTokens = productName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  const resultScore = (result: (typeof results)[number]) => {
    const url = new URL(result.link);
    const title = result.title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const searchable = `${title} ${result.snippet.toLowerCase()} ${url.pathname.toLowerCase()}`;
    return (
      productTokens.filter((token) => searchable.includes(token)).length * 10 +
      productTokens.filter((token) => title.includes(token)).length * 8 +
      (url.pathname !== '/' ? 5 : 0) +
      (/\/p\/?$/.test(url.pathname) ? 10 : 0)
    );
  };
  const verifiedFallback = async () => {
    const compactProductName = productName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const byDomain = new Map<string, typeof results>();
    for (const result of results) {
      const domain = new URL(result.link).hostname.toLowerCase().replace(/^www\./, '');
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), result]);
    }
    const candidateDomains = [...byDomain.entries()].sort(
      (left, right) => right[1].length - left[1].length,
    );
    for (const [domainValue, domainResults] of candidateDomains) {
      try {
        const domain = manufacturerDomainSchema.parse(domainValue);
        const brandToken = domain.split('.')[0]!.replace(/[^a-z0-9]/g, '');
        const institutionalResult = domainResults.find((result) => {
          const url = new URL(result.link);
          const compactTitle = result.title
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
          return url.pathname === '/' && compactTitle.includes(brandToken);
        });
        const candidate = [...domainResults].sort(
          (left, right) => resultScore(right) - resultScore(left),
        )[0]!;
        const normalizedCandidate = `${candidate.title} ${candidate.snippet}`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        const coverage = productTokens.filter((token) =>
          normalizedCandidate.includes(token),
        ).length;
        if (coverage < Math.ceil(productTokens.length * 0.6)) continue;
        const corroboratedBrand = results.some((result) => {
          if (new URL(result.link).hostname.toLowerCase().replace(/^www\./, '') === domain)
            return false;
          const evidence = `${result.title} ${result.snippet}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          const evidenceCoverage = productTokens.filter((token) => evidence.includes(token)).length;
          return (
            evidence.replace(/[^a-z0-9]/g, '').includes(brandToken) &&
            evidenceCoverage >= Math.ceil(productTokens.length * 0.6)
          );
        });
        const knownBrand = compactProductName.includes(brandToken) && !!institutionalResult;
        if (!brandToken || (!knownBrand && !corroboratedBrand)) continue;
        const source = await fetchOfficialSource(candidate.link, domain);
        return {
          manufacturer: domain.split('.')[0]!,
          domain,
          sourceUrl: source.url,
        };
      } catch {
        // Continue until an exact manufacturer-owned source is verified.
      }
    }
    return null;
  };

  const openai = new OpenAI({ apiKey: openaiKey });
  const completion = await openai.chat.completions.parse({
    model: process.env.OPENAI_PRODUCT_FACTS_MODEL?.trim() || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'Selecione uma fonte somente quando o resultado for inequivocamente uma página do fabricante oficial e corresponder ao produto exato, incluindo marca e apresentação. Rejeite lojas, marketplaces, distribuidores, redes sociais, blogs e agregadores. Se não houver comprovação suficiente nos resultados, retorne source=null. A sourceUrl deve ser copiada exatamente de um resultado fornecido.',
      },
      { role: 'user', content: JSON.stringify({ productName, results }) },
    ],
    response_format: zodResponseFormat(officialIdentitySchema, 'official_product_source'),
  });
  const selected = completion.choices[0]?.message.parsed?.source;
  if (!selected) return verifiedFallback();
  let selectedUrl: URL;
  try {
    selectedUrl = new URL(selected.sourceUrl);
  } catch {
    return verifiedFallback();
  }
  const normalizedSelectedPath = selectedUrl.pathname.replace(/\/$/, '') || '/';
  const matchedResult = results.find((result) => {
    const resultUrl = new URL(result.link);
    return (
      resultUrl.origin === selectedUrl.origin &&
      (resultUrl.pathname.replace(/\/$/, '') || '/') === normalizedSelectedPath
    );
  });
  if (!matchedResult) return verifiedFallback();
  const domain = manufacturerDomainSchema.parse(
    selectedUrl.hostname.toLowerCase().replace(/^www\./, ''),
  );
  const manufacturerToken = selected.manufacturer
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const domainBrandToken = domain.split('.')[0]!.replace(/[^a-z0-9]/g, '');
  if (
    !manufacturerToken ||
    !domainBrandToken ||
    (!manufacturerToken.includes(domainBrandToken) && !domainBrandToken.includes(manufacturerToken))
  ) {
    return verifiedFallback();
  }
  const officialResults = results.filter((result) => {
    const hostname = new URL(result.link).hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
  const sourceResult = officialResults.sort(
    (left, right) => resultScore(right) - resultScore(left),
  )[0];
  return {
    manufacturer: selected.manufacturer,
    domain,
    sourceUrl: sourceResult?.link ?? matchedResult.link,
  };
}

async function discoverOfficialUrls(productName: string, domain: string) {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey)
    throw new AppError('SERPER_API_KEY não configurada; sincronização não executada.', 503);
  const response = await axios.post<{ organic?: SerperResult[] }>(
    'https://google.serper.dev/search',
    { q: `site:${domain} ${productName}`, num: 10 },
    { timeout: 10_000, headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } },
  );
  return (response.data.organic ?? [])
    .flatMap(({ link }) => (typeof link === 'string' ? [link] : []))
    .filter((link) => {
      try {
        validateManufacturerSourceUrl(link, domain);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 5);
}

async function extractFacts(productName: string, sourceUrl: string, sourceText: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new AppError('OPENAI_API_KEY não configurada; sincronização não executada.', 503);
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.parse({
    model: process.env.OPENAI_PRODUCT_FACTS_MODEL?.trim() || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'Extraia somente texto literal da fonte oficial para o produto exato pedido. Não infira, resuma, traduza, complete dosagens ou faça alegações médicas. Preserve a ordem e o texto do rótulo, inclusive unidades brasileiras. Cada fato deve ter trechos literais de evidência presentes na fonte. Marque exactProductMatch=false se nome, variante, sabor, tamanho ou apresentação não forem inequivocamente o produto pedido.',
      },
      { role: 'user', content: JSON.stringify({ productName, sourceUrl, sourceText }) },
    ],
    response_format: zodResponseFormat(productFactsExtractionSchema, 'product_label_facts'),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error('A extração estruturada retornou vazia.');
  return validateLiteralExtraction(parsed, sourceText);
}

export class ProductFactsService {
  async getByProductId(productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { labelFacts: true },
    });
    if (!product) throw new AppError('Produto não encontrado.', 404);
    return product.labelFacts;
  }

  async sync(productId: string, input: SyncProductLabelInput) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { labelFacts: true },
    });
    if (!product) throw new AppError('Produto não encontrado.', 404);

    const domainValue = input.manufacturerDomain ?? product.labelFacts?.manufacturerDomain;
    if (!domainValue) throw new AppError('manufacturerDomain é obrigatório para sincronizar.', 400);
    const domain = manufacturerDomainSchema.parse(domainValue);
    if (input.sourceUrl) validateManufacturerSourceUrl(input.sourceUrl, domain);

    const mark = async (status: 'NOT_FOUND' | 'FAILED') =>
      prisma.productLabel.upsert({
        where: { productId },
        create: { productId, manufacturerDomain: domain, status },
        update: {
          manufacturerDomain: domain,
          status,
          exactProductMatch: false,
          version: { increment: 1 },
        },
      });

    try {
      const urls = input.sourceUrl
        ? [input.sourceUrl]
        : await discoverOfficialUrls(product.name, domain);
      if (urls.length === 0) {
        await mark('NOT_FOUND');
        throw new AppError('Nenhuma fonte oficial encontrada para o produto exato.', 404);
      }

      for (const candidate of urls) {
        try {
          const source = await fetchOfficialSource(candidate, domain);
          const facts = await extractFacts(product.name, source.url, source.text);
          return await prisma.productLabel.upsert({
            where: { productId },
            create: {
              productId,
              manufacturerDomain: domain,
              sourceUrl: source.url,
              sourceTitle: facts.sourceTitle,
              sourceRetrievedAt: new Date(),
              sourceHash: crypto.createHash('sha256').update(source.buffer).digest('hex'),
              servingSize: facts.servingSize?.value ?? null,
              servingsPerContainer: facts.servingsPerContainer?.value ?? null,
              usageInstructions: facts.usageInstructions?.value ?? null,
              ingredients: facts.ingredients?.value ?? null,
              allergenStatement: facts.allergenStatement?.value ?? null,
              warnings: facts.warnings?.value ?? Prisma.JsonNull,
              nutritionFacts: facts.nutritionFacts?.value ?? Prisma.JsonNull,
              exactProductMatch: true,
              status: 'SOURCE_MATCHED',
            },
            update: {
              manufacturerDomain: domain,
              sourceUrl: source.url,
              sourceTitle: facts.sourceTitle,
              sourceRetrievedAt: new Date(),
              sourceHash: crypto.createHash('sha256').update(source.buffer).digest('hex'),
              servingSize: facts.servingSize?.value ?? null,
              servingsPerContainer: facts.servingsPerContainer?.value ?? null,
              usageInstructions: facts.usageInstructions?.value ?? null,
              ingredients: facts.ingredients?.value ?? null,
              allergenStatement: facts.allergenStatement?.value ?? null,
              warnings: facts.warnings?.value ?? Prisma.JsonNull,
              nutritionFacts: facts.nutritionFacts?.value ?? Prisma.JsonNull,
              exactProductMatch: true,
              status: 'SOURCE_MATCHED',
              version: { increment: 1 },
            },
          });
        } catch (error) {
          if (error instanceof AppError && error.statusCode === 503) throw error;
        }
      }
      await mark('NOT_FOUND');
      throw new AppError(
        'As fontes oficiais não comprovaram correspondência exata do produto.',
        422,
      );
    } catch (error) {
      if (!(error instanceof AppError) || (error.statusCode !== 404 && error.statusCode !== 422)) {
        await mark('FAILED');
      }
      if (error instanceof AppError) throw error;
      throw new AppError('Falha segura ao sincronizar fatos do fabricante.', 502);
    }
  }

  async syncForConsultant(productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { labelFacts: true },
    });
    if (!product) throw new AppError('Produto não encontrado.', 404);
    if (
      product.labelFacts?.status === 'SOURCE_MATCHED' &&
      product.labelFacts.exactProductMatch &&
      product.labelFacts.sourceUrl
    ) {
      return product.labelFacts;
    }

    if (product.labelFacts?.manufacturerDomain) {
      return this.sync(productId, {});
    }

    const identity = await discoverOfficialIdentity(product.name);
    if (!identity) {
      throw new AppError('Não foi possível confirmar uma fonte oficial para o produto exato.', 404);
    }
    const label = await this.sync(productId, {
      manufacturerDomain: identity.domain,
      sourceUrl: identity.sourceUrl,
    });
    return prisma.productLabel.update({
      where: { productId },
      data: { manufacturer: identity.manufacturer },
    });
  }
}
