import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { StorefrontConsultantMessageRole } from '@prisma/client';
import { logger } from '../../shared/logger.js';
import type { ConsultantCandidate } from './storefrontConsultant.catalog.js';
import type { ResearchedProductProfile } from './storefrontConsultant.research.js';
import { modelConsultantResponseSchema } from './storefrontConsultant.schemas.js';

type GeneratedAnswer = {
  content: string;
  recommendationKeys: string[];
};

type ConsultantHistoryMessage = { role: StorefrontConsultantMessageRole; content: string };

function plainText(content: string) {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`#]/g, '')
    .trim();
}

function isConservativeResponse(content: string) {
  const normalized = content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return ![
    'seguro para voce',
    'interacao medicamentosa',
    'dosagem',
    'dose recomendada',
    'tome ',
    'cura ',
    'trata ',
    'previne ',
  ].some((claim) => normalized.includes(claim));
}

function mentionsCandidate(content: string, candidates: ConsultantCandidate[]) {
  const normalizedContent = content.toLocaleLowerCase('pt-BR');
  return candidates.some((candidate) =>
    normalizedContent.includes(candidate.name.toLocaleLowerCase('pt-BR')),
  );
}

function fallback(candidates: ConsultantCandidate[]): GeneratedAnswer {
  const available = candidates.filter((candidate) => candidate.available).slice(0, 3);
  if (available.length === 0) {
    return {
      content:
        'Não encontrei uma opção disponível no catálogo para esse pedido. Tente informar o tipo de suplemento ou produto que você procura.',
      recommendationKeys: [],
    };
  }

  return {
    content:
      'Encontrei estas opções no catálogo. Confira os detalhes e a composição no rótulo antes de escolher.',
    recommendationKeys: available.map((candidate) => `${candidate.type}:${candidate.id}`),
  };
}

export async function generateConsultantAnswer(
  content: string,
  candidates: ConsultantCandidate[],
  history: ConsultantHistoryMessage[],
  researchedProfiles: ReadonlyMap<string, ResearchedProductProfile> = new Map(),
): Promise<GeneratedAnswer> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || candidates.length === 0) return fallback(candidates);

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.parse({
      model: process.env.OPENAI_CONSULTANT_MODEL?.trim() || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'Você é um consultor de catálogo de suplementos em pt-BR. Entenda o objetivo do cliente e escolha as opções mais relacionadas entre os candidatos reais. O campo content deve ter no máximo 2 frases introdutórias, sem Markdown, sem listar nomes e sem atribuir efeito, benefício ou característica a um produto individual; os cards serão exibidos separadamente. Não faça diagnóstico, promessa de resultado, prescrição, avaliação de segurança individual ou afirmações sobre interação medicamentosa. Descrições comerciais ajudam apenas a localizar o tipo de produto; dados específicos de composição só podem vir de labelFacts ou researchedProfile. Nunca complete fatos ausentes por conhecimento próprio. Escolha no máximo 3 itens disponíveis e somente IDs presentes nos candidatos. Não repita preço ou fonte e não mencione itens fora da lista.',
        },
        ...history.slice(-8).map((message) => ({
          role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
          content: message.content,
        })),
        {
          role: 'user',
          content: JSON.stringify({
            pedido: content,
            candidatos: candidates.map((candidate) => ({
              type: candidate.type,
              id: candidate.id,
              name: candidate.name,
              price: candidate.price,
              available: candidate.available,
              categories: candidate.categories,
              description: candidate.description,
              ...(candidate.type === 'product' && candidate.labelFacts
                ? { labelFacts: candidate.labelFacts }
                : {}),
              ...(candidate.type === 'product' && researchedProfiles.has(candidate.id)
                ? { researchedProfile: researchedProfiles.get(candidate.id) }
                : {}),
            })),
          }),
        },
      ],
      response_format: zodResponseFormat(modelConsultantResponseSchema, 'consultant_response'),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) return fallback(candidates);

    const candidateKeys = new Set(
      candidates
        .filter((candidate) => candidate.available)
        .map((candidate) => `${candidate.type}:${candidate.id}`),
    );
    const recommendationKeys = [
      ...new Set(
        parsed.recommendations
          .map(({ type, id }) => `${type}:${id}`)
          .filter((key) => candidateKeys.has(key)),
      ),
    ].slice(0, 3);

    const responseContent = plainText(parsed.content);
    if (
      !responseContent ||
      !isConservativeResponse(responseContent) ||
      mentionsCandidate(responseContent, candidates)
    )
      return fallback(candidates);
    return { content: responseContent, recommendationKeys };
  } catch (error) {
    logger.warn({ err: error }, 'Storefront consultant OpenAI fallback used');
    return fallback(candidates);
  }
}
