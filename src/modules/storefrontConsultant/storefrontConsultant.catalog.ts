import { prisma } from '../../database/prisma.js';
import type { ConsultantContext } from './storefrontConsultant.schemas.js';
import {
  isReferentialRequest,
  searchCatalog,
  type CatalogSearchDocument,
} from './storefrontConsultant.search.js';
import { publishableLabelFacts } from './storefrontConsultant.facts.js';
import type { ConsultantCategory } from './storefrontConsultant.intent.js';

type CandidateBase = {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: number;
  available: boolean;
  categories: string[];
  contextMatch?: boolean;
};

export type OfficialLabelFacts = {
  manufacturer: string | null;
  manufacturerDomain: string;
  servingSize: string | null;
  servingsPerContainer: string | null;
  usageInstructions: string | null;
  ingredients: string | null;
  allergenStatement: string | null;
  warnings: string[] | null;
  nutritionFacts: Array<{
    nutrient: string;
    amount: string | { value: number; unit: string };
    dailyValuePercent: number | null;
  }> | null;
  source: { url: string; title: string | null; retrievedAt: string };
};

export type ConsultantCandidate =
  | (CandidateBase & { type: 'product'; labelFacts: OfficialLabelFacts | null })
  | (CandidateBase & { type: 'kit' });

export async function listConsultantCategories(): Promise<ConsultantCategory[]> {
  return prisma.category.findMany({
    where: { deletedAt: null, products: { some: { isActive: true, deletedAt: null } } },
    select: { name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

export async function findConsultantCandidates(
  content: string,
  context: ConsultantContext,
  recentRecommendationKeys: readonly string[] = [],
  semantic?: { categorySlugs: readonly string[]; catalogTerms: readonly string[] },
): Promise<ConsultantCandidate[]> {
  if (!content.trim()) return [];

  const [products, kits] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        price: true,
        stock: true,
        labelFacts: {
          select: {
            manufacturer: true,
            manufacturerDomain: true,
            sourceUrl: true,
            sourceTitle: true,
            sourceRetrievedAt: true,
            servingSize: true,
            servingsPerContainer: true,
            usageInstructions: true,
            ingredients: true,
            allergenStatement: true,
            warnings: true,
            nutritionFacts: true,
            status: true,
            exactProductMatch: true,
          },
        },
        categories: { select: { name: true, slug: true } },
      },
      orderBy: { id: 'asc' },
      take: 250,
    }),
    prisma.kit.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        finalPrice: true,
        items: {
          select: {
            quantity: true,
            product: {
              select: {
                name: true,
                slug: true,
                stock: true,
                isActive: true,
                deletedAt: true,
                categories: { select: { name: true, slug: true } },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: 100,
    }),
  ]);

  if (isReferentialRequest(content) && context.item) {
    if (
      context.item.type === 'product' &&
      !products.some(
        (product) => product.id === context.item?.id && product.slug === context.item.slug,
      )
    ) {
      const contextProduct = await prisma.product.findFirst({
        where: {
          id: context.item.id,
          slug: context.item.slug,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          imageUrl: true,
          price: true,
          stock: true,
          labelFacts: {
            select: {
              manufacturer: true,
              manufacturerDomain: true,
              sourceUrl: true,
              sourceTitle: true,
              sourceRetrievedAt: true,
              servingSize: true,
              servingsPerContainer: true,
              usageInstructions: true,
              ingredients: true,
              allergenStatement: true,
              warnings: true,
              nutritionFacts: true,
              status: true,
              exactProductMatch: true,
            },
          },
          categories: { select: { name: true, slug: true } },
        },
      });
      if (contextProduct) products.push(contextProduct);
    }
    if (
      context.item.type === 'kit' &&
      !kits.some((kit) => kit.id === context.item?.id && kit.slug === context.item.slug)
    ) {
      const contextKit = await prisma.kit.findFirst({
        where: {
          id: context.item.id,
          slug: context.item.slug,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          imageUrl: true,
          finalPrice: true,
          items: {
            select: {
              quantity: true,
              product: {
                select: {
                  name: true,
                  slug: true,
                  stock: true,
                  isActive: true,
                  deletedAt: true,
                  categories: { select: { name: true, slug: true } },
                },
              },
            },
          },
        },
      });
      if (contextKit) kits.push(contextKit);
    }
  }

  const indexed: Array<{ candidate: ConsultantCandidate; search: CatalogSearchDocument }> = [
    ...products.map((product) => ({
      search: {
        type: 'product' as const,
        id: product.id,
        slug: product.slug,
        name: product.name,
        available: product.stock > 0,
        categories: product.categories.flatMap((category) => [category.name, category.slug]),
      },
      candidate: {
        type: 'product' as const,
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description ?? '',
        imageUrl: product.imageUrl,
        price: Number(product.price),
        available: product.stock > 0,
        categories: product.categories.flatMap((category) => [category.name, category.slug]),
        contextMatch:
          context.item?.type === 'product' &&
          context.item.id === product.id &&
          context.item.slug === product.slug,
        labelFacts: publishableLabelFacts(product.labelFacts),
      },
    })),
    ...kits.map((kit) => ({
      search: {
        type: 'kit' as const,
        id: kit.id,
        slug: kit.slug,
        name: kit.name,
        available:
          kit.items.length > 0 &&
          kit.items.every(
            ({ product, quantity }) =>
              product.isActive && product.deletedAt === null && product.stock >= quantity,
          ),
        categories: kit.items.flatMap(({ product }) =>
          product.categories.flatMap((category) => [category.name, category.slug]),
        ),
        itemNames: kit.items.flatMap(({ product }) => [product.name, product.slug]),
      },
      candidate: {
        type: 'kit' as const,
        id: kit.id,
        slug: kit.slug,
        name: kit.name,
        description: kit.description ?? '',
        imageUrl: kit.imageUrl,
        price: Number(kit.finalPrice),
        available:
          kit.items.length > 0 &&
          kit.items.every(
            ({ product, quantity }) =>
              product.isActive && product.deletedAt === null && product.stock >= quantity,
          ),
        categories: kit.items.flatMap(({ product }) =>
          product.categories.flatMap((category) => [category.name, category.slug]),
        ),
        contextMatch:
          context.item?.type === 'kit' &&
          context.item.id === kit.id &&
          context.item.slug === kit.slug,
      },
    })),
  ];

  const byKey = new Map(indexed.map((entry) => [`${entry.search.type}:${entry.search.id}`, entry]));
  const matched = searchCatalog(
    content,
    indexed.map(({ search }) => search),
    context.item,
  ).map(({ document }) => byKey.get(`${document.type}:${document.id}`)!.candidate);

  if (semantic && (semantic.categorySlugs.length > 0 || semantic.catalogTerms.length > 0)) {
    const selectedCategories = new Set(semantic.categorySlugs.map((value) => value.toLowerCase()));
    const terms = semantic.catalogTerms.map((value) => value.toLowerCase());
    const relevance = (entry: (typeof indexed)[number]) => {
      const text = `${entry.candidate.name} ${entry.candidate.description}`.toLowerCase();
      return terms.filter((term) => text.includes(term)).length;
    };
    const semanticMatches = indexed
      .filter(
        ({ search }) =>
          selectedCategories.size === 0 ||
          search.categories.some((category) => selectedCategories.has(category.toLowerCase())),
      )
      .filter((entry) => selectedCategories.size > 0 || relevance(entry) > 0)
      .sort((left, right) => {
        const relevanceDifference = relevance(right) - relevance(left);
        if (relevanceDifference !== 0) return relevanceDifference;
        return Number(right.candidate.available) - Number(left.candidate.available);
      })
      .map(({ candidate }) => candidate)
      .slice(0, 12);
    if (semanticMatches.length > 0) return semanticMatches;
  }

  if (!isReferentialRequest(content) || recentRecommendationKeys.length === 0) return matched;

  const matchedByKey = new Map(
    matched.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
  );
  const recentMatches = recentRecommendationKeys.flatMap((key) => {
    const candidate = matchedByKey.get(key);
    return candidate ? [candidate] : [];
  });
  const contextual = matched.find((candidate) => candidate.contextMatch);
  if (
    contextual &&
    !recentMatches.some(
      (candidate) => candidate.type === contextual.type && candidate.id === contextual.id,
    )
  ) {
    recentMatches.push(contextual);
  }
  if (recentMatches.length > 0) return recentMatches;
  if (matched.length > 0) return matched;

  return recentRecommendationKeys
    .flatMap((key) => {
      const entry = byKey.get(key);
      return entry ? [entry.candidate] : [];
    })
    .slice(0, 8);
}
