import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { logger } from '../../shared/logger.js';
import { normalizeSearchText } from './storefrontConsultant.search.js';

export type ConsultantCategory = { name: string; slug: string };

const consultantIntentSchema = z.object({
  isRecommendationRequest: z.boolean(),
  requestKind: z.enum([
    'informational',
    'catalog_search',
    'recommendation',
    'availability',
    'price',
  ]),
  catalogItemTypes: z.array(z.enum(['product', 'kit'])).max(2),
  goal: z.string().trim().min(1).max(120).nullable(),
  categorySlugs: z.array(z.string().trim().min(1)).max(4),
  catalogTerms: z.array(z.string().trim().min(1).max(60)).max(8),
  healthScreen: z.enum(['not_required', 'needs_screening', 'clear', 'risk']),
  avoidsStimulants: z.boolean().nullable(),
  requiresComposition: z.boolean(),
});

export type ConsultantIntent = z.infer<typeof consultantIntentSchema>;

export const HEALTH_SCREEN_QUESTION =
  'Antes de indicar opções, preciso saber: você tem alguma condição de saúde, como pressão alta, problema cardíaco, diabetes, ansiedade, doença renal ou hepática, está grávida ou amamentando, é menor de 18 anos ou usa medicamentos? Você prefere evitar cafeína ou outros estimulantes?';

export const HEALTH_RISK_RESPONSE =
  'Como você informou uma condição de saúde, uso de medicamento, gestação, amamentação ou menor idade, não posso escolher um suplemento com segurança. Consulte um médico ou nutricionista antes de utilizar qualquer produto.';

export function hasExplicitCommercialIntent(content: string) {
  const text = normalizeSearchText(content);
  if (
    /\b(?:comprar|compra|preco|precos|quanto custa)\b/.test(text) ||
    /\b(?:tem|ha)\b.{0,40}\bdisponive(?:l|is)\b/.test(text) ||
    /\b(?:tem|ha)\b.{0,80}\b(?:combo|combos|kit|kits|promocao|promocoes|produto|produtos|suplemento|suplementos)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:quero|queria|gostaria de) (?:saber|entender|conhecer|tirar uma duvida|uma informacao|informacoes|uma explicacao)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return [
    /\b(?:me )?(?:indique|indicar|recomende|recomendar|sugira|sugerir|mostre|mostrar|liste|listar)\b/,
    /\b(?:quero|preciso|procuro|busco) (?!saber\b|entender\b|conhecer\b|informacao\b|informacoes\b|uma informacao\b|uma explicacao\b|uma orientacao\b)/,
    /\bqual\b.{0,30}\b(?:voce |voces )?(?:indica|recomenda)\b/,
  ].some((pattern) => pattern.test(text));
}

export function allowsConsultantRecommendations(
  content: string,
  semanticCommercialIntent: boolean,
  plannedRecommendation: boolean,
  hasActiveHealthScreen: boolean,
) {
  if (hasExplicitCommercialIntent(content)) return true;
  if (semanticCommercialIntent) return true;
  const text = normalizeSearchText(content);
  const answersHealthScreen =
    !/\b(?:como|qual|quais|quando|onde|por que|o que)\b/.test(text) &&
    /\b(?:nao|nenhum|nenhuma|tenho|uso|tomo|sou|estou|medicamento|remedio|gestante|gravida|amament|menor|pressao|cardiac|diabetes|ansiedade|renal|hepat|cafeina|estimulante)\b/.test(
      text,
    );
  return plannedRecommendation && hasActiveHealthScreen && answersHealthScreen;
}

export async function planConsultantIntent(
  currentMessage: string,
  previousUserMessages: string[],
  categories: ConsultantCategory[],
): Promise<ConsultantIntent | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || categories.length === 0) return null;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.parse({
      model: process.env.OPENAI_CONSULTANT_MODEL?.trim() || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Você classifica mensagens para um catálogo real de suplementos. Ignore erros ortográficos, interjeições, gírias, palavrões e palavras de preenchimento; extraia a intenção útil sem repetir esses termos. requestKind=informational para perguntas sobre funcionamento, composição, uso, efeitos ou diferenças; catalog_search para quem procura itens; recommendation para pedidos de indicação; availability para perguntas se a loja tem algo; price para preço. isRecommendationRequest=true para qualquer intenção comercial de buscar, indicar, verificar disponibilidade ou preço, e false para informação. Combo, pacote, conjunto, cesta promocional e promoção de produtos significam catalogItemTypes=[kit]. Um suplemento individual significa product; use ambos somente quando realmente pedido. Entenda o objetivo em linguagem natural; não exija que o cliente cite o nome de uma categoria. Escolha somente categorySlugs fornecidos. Se nenhuma categoria representar o objetivo, retorne categorySlugs vazio e use catalogTerms limpos, sem gírias ou palavrões, para localizar itens; nunca associe sono/relaxamento a Energia ou Pré-Treino. Use o histórico para continuar uma triagem iniciada antes. Pedidos de recomendação para emagrecimento, termogênicos, energia, pré-treino, sono ou relaxamento exigem triagem. Nesses casos use needs_screening até o cliente negar explicitamente condições de saúde, pressão alta, problema cardíaco, diabetes, ansiedade relevante, doença renal/hepática, gestação/amamentação, menor idade e uso de medicamentos. Use risk quando ele confirmar qualquer um desses fatores, e clear somente após negativa explícita. not_required vale para perguntas que não exigem essa triagem. avoidsStimulants deve refletir preferência explícita sobre cafeína/estimulantes. Toda recomendação baseada em objetivo, ingrediente, cafeína, lactose, alérgeno ou vitamina exige requiresComposition=true. Não invente categorias.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            currentMessage,
            previousUserMessages: previousUserMessages.slice(-8),
            categories,
          }),
        },
      ],
      response_format: zodResponseFormat(consultantIntentSchema, 'consultant_catalog_intent'),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) return null;
    const allowed = new Set(categories.map((category) => category.slug));
    const categorySlugs = parsed.categorySlugs.filter((slug) => allowed.has(slug));
    const sleepGoal = /\b(?:sono|dormir|relax)/i.test(parsed.goal ?? currentMessage);
    const categoryBySlug = new Map(categories.map((category) => [category.slug, category.name]));
    return {
      ...parsed,
      categorySlugs: sleepGoal
        ? categorySlugs.filter((slug) => !/energia|treino/i.test(categoryBySlug.get(slug) ?? ''))
        : categorySlugs,
      requiresComposition:
        parsed.requiresComposition || (parsed.isRecommendationRequest && parsed.goal !== null),
    };
  } catch (error) {
    logger.warn({ err: error }, 'Consultant semantic intent planning failed');
    return null;
  }
}
