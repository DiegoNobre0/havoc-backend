import { z } from 'zod';

export const manufacturerDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .refine((value) => !value.includes('://') && !value.includes('/') && !value.includes(':'), {
    message: 'Informe apenas o domínio do fabricante, sem protocolo, porta ou caminho.',
  })
  .refine(
    (value) =>
      value !== 'localhost' &&
      !/^\d+(?:\.\d+){3}$/.test(value) &&
      value.includes('.') &&
      value.split('.').every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)),
    { message: 'Domínio do fabricante inválido.' },
  );

export function hostnameMatchesDomain(hostname: string, domain: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');
  const normalizedDomain = manufacturerDomainSchema.parse(domain).replace(/\.$/, '');
  return (
    normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

export const manufacturerSourceUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      context.addIssue({ code: 'custom', message: 'A URL deve usar HTTP ou HTTPS.' });
    }
    if (url.username || url.password || url.port) {
      context.addIssue({ code: 'custom', message: 'Credenciais e portas não são permitidas.' });
    }
  });

export const nutritionAmountSchema = z.union([
  z.string().trim().min(1),
  z.object({ value: z.number(), unit: z.string().trim().min(1) }).strict(),
]);

export const nutritionRowSchema = z
  .object({
    nutrient: z.string().trim().min(1),
    amount: nutritionAmountSchema,
    dailyValuePercent: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export const nutritionFactsSchema = z.array(nutritionRowSchema).min(1).max(200);

export const editableProductFactsSchema = z
  .object({
    servingSize: z.string().trim().min(1).nullable().optional(),
    servingsPerContainer: z.string().trim().min(1).nullable().optional(),
    usageInstructions: z.string().trim().min(1).nullable().optional(),
    ingredients: z.string().trim().min(1).nullable().optional(),
    allergenStatement: z.string().trim().min(1).nullable().optional(),
    warnings: z.array(z.string().trim().min(1)).max(100).nullable().optional(),
    nutritionFacts: nutritionFactsSchema.nullable().optional(),
  })
  .strict();

export const syncProductLabelSchema = z
  .object({
    manufacturerDomain: manufacturerDomainSchema.optional(),
    sourceUrl: manufacturerSourceUrlSchema.optional(),
  })
  .strict();

const evidenced = <T extends z.ZodType>(value: T) =>
  z
    .object({ value, evidence: z.array(z.string().trim().min(1)).min(1).max(10) })
    .strict()
    .nullable();

export const productFactsExtractionSchema = z
  .object({
    exactProductMatch: z.boolean(),
    identityEvidence: z.array(z.string().trim().min(1)).min(1).max(10),
    sourceTitle: z.string().trim().min(1).nullable(),
    servingSize: evidenced(z.string().trim().min(1)),
    servingsPerContainer: evidenced(z.string().trim().min(1)),
    usageInstructions: evidenced(z.string().trim().min(1)),
    ingredients: evidenced(z.string().trim().min(1)),
    allergenStatement: evidenced(z.string().trim().min(1)),
    warnings: evidenced(z.array(z.string().trim().min(1)).min(1).max(100)),
    nutritionFacts: evidenced(nutritionFactsSchema),
  })
  .strict();

export type ProductFactsExtraction = z.infer<typeof productFactsExtractionSchema>;
export type SyncProductLabelInput = z.infer<typeof syncProductLabelSchema>;

function normalizedEvidence(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
}

export function validateLiteralExtraction(input: unknown, sourceText: string) {
  const extraction = productFactsExtractionSchema.parse(input);
  if (!extraction.exactProductMatch)
    throw new Error('A fonte não corresponde exatamente ao produto.');

  const normalizedSource = normalizedEvidence(sourceText);
  const facts = [
    extraction.servingSize,
    extraction.servingsPerContainer,
    extraction.usageInstructions,
    extraction.ingredients,
    extraction.allergenStatement,
    extraction.warnings,
    extraction.nutritionFacts,
  ];
  if (!facts.some(Boolean)) throw new Error('A fonte não contém fatos de rótulo extraíveis.');

  const snippets = [
    ...extraction.identityEvidence,
    ...facts.flatMap((fact) => fact?.evidence ?? []),
  ];
  if (snippets.some((snippet) => !normalizedSource.includes(normalizedEvidence(snippet)))) {
    throw new Error('A evidência retornada não existe literalmente na fonte.');
  }
  return extraction;
}
