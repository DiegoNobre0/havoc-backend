import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
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
import { productIdentityHash } from './product-facts.identity.js';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_TEXT = 100_000;
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain', 'application/pdf'];

export function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
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
      normalized.startsWith('2001:db8:') ||
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
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError('Não foi possível resolver o domínio do fabricante.', 422);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AppError('O domínio do fabricante resolve para uma rede não permitida.', 400);
  }
  return addresses[0]!;
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
    const destination = await assertPublicDestination(url.hostname);
    const lookup = (
      _hostname: string,
      _options: unknown,
      callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
    ) => callback(null, destination.address, destination.family);
    const httpAgent = new http.Agent({ lookup });
    const httpsAgent = new https.Agent({ lookup });
    let response;
    try {
      response = await axios.get<ArrayBuffer>(url.toString(), {
        responseType: 'arraybuffer',
        timeout: 10_000,
        maxContentLength: MAX_SOURCE_BYTES,
        maxBodyLength: MAX_SOURCE_BYTES,
        maxRedirects: 0,
        proxy: false,
        httpAgent,
        httpsAgent,
        validateStatus: (status) =>
          (status >= 200 && status < 300) || (status >= 300 && status < 400),
        headers: { 'User-Agent': 'HavocProductLabelSync/1.0' },
      });
    } finally {
      httpAgent.destroy();
      httpsAgent.destroy();
    }

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
  return {
    manufacturer: selected.manufacturer,
    domain,
    sourceUrl: matchedResult.link,
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
  try {
    return validateLiteralExtraction(parsed, sourceText);
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'A fonte não comprovou o produto exato.',
      422,
    );
  }
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

  async sync(
    productId: string,
    input: SyncProductLabelInput = {},
    expectedIdentityHash?: string,
    expectedLabelVersion?: number,
  ) {
    const { redis } = await import('../../../shared/redis/redis.js');
    const lockKey = `product-label:sync:${productId}`;
    const lockToken = crypto.randomUUID();
    const acquired = await redis.set(lockKey, lockToken, 'PX', 120_000, 'NX');
    if (!acquired) throw new AppError('A sincronização deste produto já está em andamento.', 423);

    let lockOwned = true;
    const renewLock = setInterval(() => {
      void redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
          1,
          lockKey,
          lockToken,
          120_000,
        )
        .then((result) => {
          if (Number(result) !== 1) lockOwned = false;
        })
        .catch(() => {
          lockOwned = false;
        });
    }, 40_000);
    renewLock.unref();

    try {
      return await this.syncUnlocked(
        productId,
        input,
        expectedIdentityHash,
        expectedLabelVersion,
        () => {
          if (!lockOwned) throw new AppError('O lock da sincronização foi perdido.', 423);
        },
      );
    } finally {
      clearInterval(renewLock);
      await redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockToken,
        )
        .catch(() => undefined);
    }
  }

  private async syncUnlocked(
    productId: string,
    input: SyncProductLabelInput,
    expectedIdentityHash?: string,
    expectedLabelVersion?: number,
    assertLockOwned: () => void = () => undefined,
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { labelFacts: true },
    });
    if (!product) throw new AppError('Produto não encontrado.', 404);

    const identityHash = productIdentityHash(product.name);
    const labelVersion = product.labelFacts?.version ?? 1;
    const hadPublishableLabel = Boolean(
      product.labelFacts?.status === 'SOURCE_MATCHED' &&
      product.labelFacts.exactProductMatch &&
      product.labelFacts.manufacturerDomain &&
      product.labelFacts.sourceUrl &&
      product.labelFacts.sourceRetrievedAt,
    );
    if (expectedIdentityHash && expectedIdentityHash !== identityHash) {
      throw new AppError('A identidade do produto mudou; sincronização descartada.', 409);
    }
    if (expectedLabelVersion && product.labelFacts?.version !== expectedLabelVersion) {
      throw new AppError('Existe uma versão mais nova do produto; job descartado.', 409);
    }

    let domain: string | null = input.manufacturerDomain
      ? manufacturerDomainSchema.parse(input.manufacturerDomain)
      : (product.labelFacts?.manufacturerDomain ?? null);
    let sourceUrl = input.sourceUrl;
    let manufacturer = product.labelFacts?.manufacturer ?? null;

    if (sourceUrl && !domain) {
      throw new AppError('Uma URL administrativa exige o domínio correspondente.', 400);
    }
    if (sourceUrl && domain) validateManufacturerSourceUrl(sourceUrl, domain);

    const clearFacts = {
      sourceUrl: null,
      sourceTitle: null,
      sourceRetrievedAt: null,
      sourceHash: null,
      evidence: Prisma.JsonNull,
      servingSize: null,
      servingsPerContainer: null,
      usageInstructions: null,
      ingredients: null,
      allergenStatement: null,
      warnings: Prisma.JsonNull,
      nutritionFacts: Prisma.JsonNull,
    };
    const mark = async (status: 'NOT_FOUND' | 'FAILED', errorCode: string) => {
      assertLockOwned();
      const nextSyncAt = new Date(
        Date.now() + (status === 'NOT_FOUND' ? 7 * 24 * 60 * 60_000 : 60 * 60_000),
      );
      const result = await prisma.productLabel.updateMany({
        where: { productId, version: labelVersion },
        data: hadPublishableLabel
          ? {
              identityHash,
              nextSyncAt,
              lastSyncErrorCode: errorCode,
            }
          : {
              manufacturer,
              manufacturerDomain: domain,
              identityHash,
              status,
              exactProductMatch: false,
              nextSyncAt,
              lastSyncErrorCode: errorCode,
              ...clearFacts,
            },
      });
      if (result.count === 0) {
        throw new AppError('O produto mudou durante a sincronização; resultado descartado.', 409);
      }
      return prisma.productLabel.findUniqueOrThrow({ where: { productId } });
    };

    if (product.labelFacts) {
      const processing = await prisma.productLabel.updateMany({
        where: { productId, version: labelVersion },
        data: {
          identityHash,
          ...(!hadPublishableLabel && { status: 'PROCESSING', exactProductMatch: false }),
          lastSyncAttemptAt: new Date(),
          nextSyncAt: null,
          lastSyncErrorCode: null,
          syncAttemptCount: { increment: 1 },
        },
      });
      if (processing.count === 0) {
        throw new AppError('O produto mudou antes do início da sincronização.', 409);
      }
    } else {
      await prisma.productLabel.create({
        data: {
          productId,
          manufacturer,
          manufacturerDomain: domain,
          identityHash,
          status: 'PROCESSING',
          lastSyncAttemptAt: new Date(),
          syncAttemptCount: 1,
        },
      });
    }

    const assertCurrentIdentity = async () => {
      assertLockOwned();
      const current = await prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { name: true, labelFacts: { select: { version: true } } },
      });
      if (
        !current ||
        productIdentityHash(current.name) !== identityHash ||
        current.labelFacts?.version !== labelVersion
      ) {
        throw new AppError('A identidade do produto mudou; sincronização descartada.', 409);
      }
    };

    try {
      if (!domain) {
        const identity = await discoverOfficialIdentity(product.name);
        if (!identity) {
          throw new AppError(
            'Não foi possível confirmar uma fonte oficial para o produto exato.',
            404,
          );
        }
        domain = identity.domain;
        manufacturer = identity.manufacturer;
        sourceUrl = identity.sourceUrl;
      }

      const urls = sourceUrl ? [sourceUrl] : await discoverOfficialUrls(product.name, domain);
      if (urls.length === 0) {
        throw new AppError('Nenhuma fonte oficial encontrada para o produto exato.', 404);
      }

      let operationalError: unknown;
      for (const candidate of urls) {
        try {
          const source = await fetchOfficialSource(candidate, domain);
          const facts = await extractFacts(product.name, source.url, source.text);
          await assertCurrentIdentity();
          const updated = await prisma.productLabel.updateMany({
            where: { productId, version: labelVersion },
            data: {
              manufacturer,
              manufacturerDomain: domain,
              sourceUrl: source.url,
              sourceTitle: facts.sourceTitle,
              sourceRetrievedAt: new Date(),
              sourceHash: crypto.createHash('sha256').update(source.buffer).digest('hex'),
              evidence: facts as unknown as Prisma.InputJsonValue,
              servingSize: facts.servingSize?.value ?? null,
              servingsPerContainer: facts.servingsPerContainer?.value ?? null,
              usageInstructions: facts.usageInstructions?.value ?? null,
              ingredients: facts.ingredients?.value ?? null,
              allergenStatement: facts.allergenStatement?.value ?? null,
              warnings: facts.warnings?.value ?? Prisma.JsonNull,
              nutritionFacts: facts.nutritionFacts?.value ?? Prisma.JsonNull,
              exactProductMatch: true,
              status: 'SOURCE_MATCHED',
              identityHash,
              nextSyncAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
              lastSyncErrorCode: null,
              version: { increment: 1 },
            },
          });
          if (updated.count === 0) {
            throw new AppError(
              'O produto mudou durante a sincronização; resultado descartado.',
              409,
            );
          }
          return await prisma.productLabel.findUniqueOrThrow({ where: { productId } });
        } catch (error) {
          if (error instanceof AppError) {
            if (error.statusCode === 409 || error.statusCode === 503) throw error;
            if ([400, 404, 422].includes(error.statusCode)) continue;
          }
          operationalError = error;
        }
      }
      if (operationalError) throw operationalError;
      throw new AppError(
        'As fontes oficiais não comprovaram correspondência exata do produto.',
        422,
      );
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) throw error;
      const notFound = error instanceof AppError && [404, 422].includes(error.statusCode);
      await mark(notFound ? 'NOT_FOUND' : 'FAILED', notFound ? 'NO_EXACT_SOURCE' : 'SYNC_FAILED');
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
      product.labelFacts.manufacturerDomain &&
      product.labelFacts.sourceUrl &&
      product.labelFacts.sourceRetrievedAt &&
      product.labelFacts.identityHash === productIdentityHash(product.name) &&
      product.labelFacts.nextSyncAt &&
      product.labelFacts.nextSyncAt > new Date()
    ) {
      return product.labelFacts;
    }
    if (product.labelFacts?.status === 'PENDING' || product.labelFacts?.status === 'PROCESSING') {
      throw new AppError('A busca automática deste produto está em andamento.', 409);
    }
    if (product.labelFacts?.nextSyncAt && product.labelFacts.nextSyncAt > new Date()) {
      if (product.labelFacts.status === 'NOT_FOUND') {
        throw new AppError('Ainda não há uma fonte exata confirmada para este produto.', 404);
      }
      if (product.labelFacts.status === 'FAILED') {
        throw new AppError('A consulta das fontes está temporariamente indisponível.', 503);
      }
    }
    return this.sync(productId, {});
  }
}
