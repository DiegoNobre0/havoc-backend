import crypto from 'node:crypto';
import { Prisma, type StorefrontConsultantMessage } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ProductFactsService } from '../catalog/productFacts/product-facts.service.js';
import { generateConsultantAnswer } from './storefrontConsultant.ai.js';
import {
  findConsultantCandidates,
  listConsultantCategories,
  type ConsultantCandidate,
} from './storefrontConsultant.catalog.js';
import {
  allowsConsultantRecommendations,
  hasExplicitCommercialIntent,
  HEALTH_RISK_RESPONSE,
  HEALTH_SCREEN_QUESTION,
  planConsultantIntent,
} from './storefrontConsultant.intent.js';
import { evaluateConsultantSafety } from './storefrontConsultant.policy.js';
import {
  detectFactIntents,
  formatOfficialFactsResponse,
  isGenericUsageQuestion,
  publishableLabelFacts,
  productSelectionIndex,
  resolveSingleProductCandidate,
} from './storefrontConsultant.facts.js';
import {
  researchExactProductUsage,
  researchExactProductProfile,
  researchGeneralQuestion,
  type ResearchedProductProfile,
  shouldResearchGeneralQuestion,
  wantsResearchSources,
} from './storefrontConsultant.research.js';
import type { ConsultantContext, CreateConsultantMessage } from './storefrontConsultant.schemas.js';
import { buildConsultantTranscriptionPrompt } from './storefrontConsultant.audio.js';
import { isKitCatalogRequest } from './storefrontConsultant.search.js';

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

type StoredRecommendation = ConsultantCandidate;

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest();
}

function mapRecommendations(value: Prisma.JsonValue | null): StoredRecommendation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const parsed = Prisma.validator<Prisma.JsonObject>()(item as Prisma.JsonObject);
    if (
      (parsed.type !== 'product' && parsed.type !== 'kit') ||
      typeof parsed.id !== 'string' ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.description !== 'string' ||
      (typeof parsed.imageUrl !== 'string' && parsed.imageUrl !== null) ||
      typeof parsed.price !== 'number' ||
      typeof parsed.available !== 'boolean'
    ) {
      return [];
    }
    return [parsed as StoredRecommendation];
  });
}

function mapMessage(message: StorefrontConsultantMessage) {
  return {
    id: message.id,
    role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    recommendations: mapRecommendations(message.recommendations),
  };
}

function mapSession(session: { id: string; clientId: string; expiresAt: Date; token?: string }) {
  return {
    sessionId: session.id,
    ...(session.token ? { sessionToken: session.token } : {}),
    expiresAt: session.expiresAt.toISOString(),
    clientId: session.clientId,
  };
}

export class StorefrontConsultantService {
  private readonly productFactsService = new ProductFactsService();

  async createSession(clientId: string) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    const session = await prisma.storefrontConsultantSession.create({
      data: { clientId, tokenHash: tokenHash(token).toString('hex'), expiresAt },
    });

    return { session: mapSession({ ...session, token }), messages: [] };
  }

  async getSession(sessionId: string, token: string) {
    const session = await this.authenticate(sessionId, token);
    const messages = await prisma.storefrontConsultantMessage.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return { session: mapSession({ ...session, token }), messages: messages.map(mapMessage) };
  }

  async endSession(sessionId: string, token: string) {
    await this.authenticate(sessionId, token);
    await prisma.storefrontConsultantSession.deleteMany({ where: { id: sessionId } });
  }

  async sendMessage(sessionId: string, token: string, input: CreateConsultantMessage) {
    await this.authenticate(sessionId, token);

    const userMessage = await this.findOrCreateUserMessage(sessionId, input);
    const existingAssistant = await prisma.storefrontConsultantMessage.findUnique({
      where: {
        sessionId_requestId_role: { sessionId, requestId: input.requestId, role: 'ASSISTANT' },
      },
    });
    if (existingAssistant) return { message: mapMessage(existingAssistant) };

    const context = userMessage.context as ConsultantContext;
    const history = await prisma.storefrontConsultantMessage.findMany({
      where: { sessionId, id: { not: userMessage.id } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    history.reverse();
    const previousUserMessages = history
      .filter((message) => message.role === 'USER')
      .map((message) => message.content);
    const safety = evaluateConsultantSafety(userMessage.content);
    let answer: { content: string; recommendations: StoredRecommendation[] };
    let recommendationsAllowed = false;

    if (safety.blocked) {
      answer = { content: safety.content, recommendations: [] };
    } else {
      const factIntents = detectFactIntents(userMessage.content);
      const explicitCommercialIntent = hasExplicitCommercialIntent(userMessage.content);
      const categories =
        factIntents.length === 0 || explicitCommercialIntent
          ? await listConsultantCategories()
          : [];
      const intent =
        categories.length > 0
          ? await planConsultantIntent(userMessage.content, previousUserMessages, categories)
          : null;
      const latestAssistant = [...history]
        .reverse()
        .find((message) => message.role === 'ASSISTANT');
      const hasActiveHealthScreen = latestAssistant?.content === HEALTH_SCREEN_QUESTION;
      const semanticCommercialIntent =
        intent?.isRecommendationRequest === true && intent.requestKind !== 'informational';
      const allowsRecommendations = allowsConsultantRecommendations(
        userMessage.content,
        semanticCommercialIntent,
        intent?.isRecommendationRequest === true,
        hasActiveHealthScreen,
      );
      recommendationsAllowed = allowsRecommendations;
      if (allowsRecommendations && intent?.healthScreen === 'needs_screening') {
        answer = { content: HEALTH_SCREEN_QUESTION, recommendations: [] };
        const assistant = await this.persistAssistant(sessionId, input.requestId, answer);
        return { message: mapMessage(assistant) };
      }
      if (allowsRecommendations && intent?.healthScreen === 'risk') {
        answer = { content: HEALTH_RISK_RESPONSE, recommendations: [] };
        const assistant = await this.persistAssistant(sessionId, input.requestId, answer);
        return { message: mapMessage(assistant) };
      }
      const recentAssistant = [...history]
        .reverse()
        .find(
          (message) =>
            message.role === 'ASSISTANT' && mapRecommendations(message.recommendations).length > 0,
        );
      const recentRecommendationKeys = mapRecommendations(
        recentAssistant?.recommendations ?? null,
      ).map((candidate) => `${candidate.type}:${candidate.id}`);
      const candidates = await findConsultantCandidates(
        userMessage.content,
        context,
        recentRecommendationKeys,
        allowsRecommendations && intent?.isRecommendationRequest
          ? {
              categorySlugs: intent.categorySlugs,
              catalogTerms: intent.catalogTerms,
              itemTypes: intent.catalogItemTypes,
            }
          : undefined,
      );
      let resolvedFactIntents = factIntents;
      if (resolvedFactIntents.length === 0 && productSelectionIndex(userMessage.content) >= 0) {
        const previousUser = [...history].reverse().find((message) => message.role === 'USER');
        if (previousUser) resolvedFactIntents = detectFactIntents(previousUser.content);
      }
      if (resolvedFactIntents.length > 0 && !allowsRecommendations) {
        let product = resolveSingleProductCandidate(userMessage.content, candidates);
        if (product) {
          let syncFailure: { content: string; recommendations: StoredRecommendation[] } | null =
            null;
          if (!product.labelFacts) {
            try {
              const synced = await this.productFactsService.syncForConsultant(product.id);
              product = { ...product, labelFacts: publishableLabelFacts(synced) };
            } catch (error) {
              const secondaryUsage =
                resolvedFactIntents.length === 1 && resolvedFactIntents[0] === 'usage'
                  ? await researchExactProductUsage(product.name, {
                      includeSources: wantsResearchSources(userMessage.content),
                    })
                  : null;
              const officialSourceWithoutFacts =
                error instanceof AppError && error.statusCode === 422;
              syncFailure = {
                content:
                  secondaryUsage ??
                  (officialSourceWithoutFacts
                    ? `Encontrei a página oficial de ${product.name}, mas ela não publica um modo de uso que eu possa confirmar. Confira a orientação da embalagem; se quiser, posso explicar o uso geral desse tipo de suplemento.`
                    : `Não encontrei o rótulo oficial exato de ${product.name}. Por segurança, não vou estimar a dose. Posso explicar o uso geral desse tipo de suplemento, mas siga a orientação da embalagem.`),
                recommendations: [product],
              };
            }
          }
          answer = syncFailure ?? {
            content: formatOfficialFactsResponse(product, resolvedFactIntents),
            recommendations: [product],
          };
        } else {
          const generalUsage =
            resolvedFactIntents.length === 1 &&
            resolvedFactIntents[0] === 'usage' &&
            isGenericUsageQuestion(userMessage.content);
          const researched =
            generalUsage || shouldResearchGeneralQuestion(userMessage.content)
              ? await researchGeneralQuestion(userMessage.content)
              : null;
          if (researched) {
            answer = { content: researched, recommendations: [] };
          } else {
            const products = candidates
              .filter((candidate) => candidate.type === 'product')
              .slice(0, 3);
            answer = {
              content:
                products.length > 0
                  ? 'Essa informação pode variar entre fórmulas e fabricantes. Informe o nome completo do produto para eu conferir o rótulo exato, ou peça uma explicação geral sobre esse tipo de suplemento.'
                  : 'Informe o nome completo do produto para eu conferir o rótulo exato, ou peça uma explicação geral sobre esse tipo de suplemento.',
              recommendations: [],
            };
          }
        }
      } else if (!allowsRecommendations && shouldResearchGeneralQuestion(userMessage.content)) {
        const researched = await researchGeneralQuestion(userMessage.content);
        if (researched) {
          answer = { content: researched, recommendations: [] };
        } else {
          answer = {
            content:
              'Não consegui consultar fontes confiáveis agora. Para não responder com informação sem comprovação, tente novamente em alguns instantes.',
            recommendations: [],
          };
        }
      } else if (allowsRecommendations) {
        let recommendationCandidates = candidates;
        const researchedProfiles = new Map<string, ResearchedProductProfile>();
        if (intent?.isRecommendationRequest && intent.requiresComposition) {
          const products = candidates
            .filter(
              (candidate): candidate is Extract<ConsultantCandidate, { type: 'product' }> =>
                candidate.type === 'product' && candidate.available,
            )
            .slice(0, 4);
          const researched = await Promise.all(
            products.map(async (product) => ({
              product,
              profile: await researchExactProductProfile(product.name),
            })),
          );
          for (const { product, profile } of researched) {
            if (profile) researchedProfiles.set(product.id, profile);
          }
          if (intent.avoidsStimulants === true) {
            recommendationCandidates = candidates.filter((candidate) => {
              if (candidate.type !== 'product') return false;
              const profile = researchedProfiles.get(candidate.id);
              const explicitlyStimulantFree = /\bsem\s+cafe[ií]na\b/i.test(
                `${candidate.name} ${candidate.description}`,
              );
              return profile?.stimulant === 'absent' || explicitlyStimulantFree;
            });
          }
        }
        const requestsKits =
          intent?.catalogItemTypes.includes('kit') === true ||
          isKitCatalogRequest(userMessage.content);
        if (
          requestsKits &&
          !recommendationCandidates.some(
            (candidate) => candidate.type === 'kit' && candidate.available,
          )
        ) {
          answer = {
            content: 'Não temos combos disponíveis no momento.',
            recommendations: [],
          };
        } else if (intent?.avoidsStimulants === true && recommendationCandidates.length === 0) {
          answer = {
            content:
              'Não encontrei no catálogo uma opção relacionada ao seu objetivo cuja ausência de cafeína ou outros estimulantes eu consiga confirmar. Prefiro não indicar um produto sem essa confirmação.',
            recommendations: [],
          };
        } else {
          const generated = await generateConsultantAnswer(
            userMessage.content,
            recommendationCandidates,
            history,
            researchedProfiles,
          );
          const selected = new Set(generated.recommendationKeys);
          answer = {
            content: generated.content,
            recommendations: recommendationCandidates
              .filter((candidate) => selected.has(`${candidate.type}:${candidate.id}`))
              .slice(0, 3),
          };
        }
      } else {
        answer = {
          content:
            'Posso explicar composição, uso, diferenças e efeitos gerais de suplementos. Se você estiver procurando um produto, diga que deseja uma indicação, opções, disponibilidade ou preço.',
          recommendations: [],
        };
      }
    }

    if (!recommendationsAllowed && answer.recommendations.length > 0) {
      answer = { ...answer, recommendations: [] };
    }

    const assistant = await this.persistAssistant(sessionId, input.requestId, answer);
    return { message: mapMessage(assistant) };
  }

  async getCompletedRequest(sessionId: string, token: string, requestId: string) {
    await this.authenticate(sessionId, token);
    const [user, assistant] = await Promise.all([
      prisma.storefrontConsultantMessage.findUnique({
        where: { sessionId_requestId_role: { sessionId, requestId, role: 'USER' } },
      }),
      prisma.storefrontConsultantMessage.findUnique({
        where: { sessionId_requestId_role: { sessionId, requestId, role: 'ASSISTANT' } },
      }),
    ]);

    if (!user || !assistant) return null;
    return { transcript: user.content, message: mapMessage(assistant) };
  }

  async getTranscriptionPrompt(sessionId: string, token: string) {
    await this.authenticate(sessionId, token);
    const history = await prisma.storefrontConsultantMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { content: true },
    });
    return buildConsultantTranscriptionPrompt(history.reverse().map((message) => message.content));
  }

  async sendTranscribedMessage(sessionId: string, token: string, input: CreateConsultantMessage) {
    const result = await this.sendMessage(sessionId, token, input);
    const user = await prisma.storefrontConsultantMessage.findUnique({
      where: {
        sessionId_requestId_role: { sessionId, requestId: input.requestId, role: 'USER' },
      },
    });
    if (!user) throw new AppError('Não foi possível persistir a transcrição.', 500);
    return { transcript: user.content, message: result.message };
  }

  private async authenticate(sessionId: string, token: string) {
    const session = await prisma.storefrontConsultantSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('Sessão do consultor inválida ou expirada.', 401);
    }

    const providedHash = tokenHash(token);
    const storedHash = Buffer.from(session.tokenHash, 'hex');
    if (
      storedHash.length !== providedHash.length ||
      !crypto.timingSafeEqual(storedHash, providedHash)
    ) {
      throw new AppError('Sessão do consultor inválida ou expirada.', 401);
    }

    return session;
  }

  private async findOrCreateUserMessage(sessionId: string, input: CreateConsultantMessage) {
    try {
      return await prisma.storefrontConsultantMessage.create({
        data: {
          sessionId,
          requestId: input.requestId,
          role: 'USER',
          content: input.content,
          context: input.context,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const existing = await prisma.storefrontConsultantMessage.findUnique({
        where: {
          sessionId_requestId_role: { sessionId, requestId: input.requestId, role: 'USER' },
        },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  private async persistAssistant(
    sessionId: string,
    requestId: string,
    answer: { content: string; recommendations: StoredRecommendation[] },
  ) {
    try {
      return await prisma.storefrontConsultantMessage.create({
        data: {
          sessionId,
          requestId,
          role: 'ASSISTANT',
          content: answer.content,
          recommendations: answer.recommendations,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const existing = await prisma.storefrontConsultantMessage.findUnique({
        where: { sessionId_requestId_role: { sessionId, requestId, role: 'ASSISTANT' } },
      });
      if (!existing) throw error;
      return existing;
    }
  }
}
