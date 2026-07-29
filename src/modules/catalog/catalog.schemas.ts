import { z } from 'zod';

// Parametros comuns
export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// ==========================================
// SCHEMAS DE CATEGORIA
// ==========================================
export const createCategorySchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  slug: z.string().min(2, 'Slug inválido'),
  description: z.string().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

// ==========================================
// SCHEMAS DE PRODUTO
// ==========================================
export const productQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(12),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

// Schema do PAYLOAD CRU vindo do Angular (product-form)
export const createProductSchema = z.object({
  name: z.string().min(2),
  slug: z.string(),
  description: z.string().optional(),
  unit: z.string().default('UN'),
  price: z.number().positive('O preço deve ser maior que zero'),
  cost_price: z.number().min(0).optional(),
  price_wholesale: z.number().min(0).optional(),
  stock_qty: z.number().int().min(0),
  stock_min: z.number().int().min(0).default(0),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  category_ids: z.array(z.string().uuid()).default([]),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial();

// ==========================================
// SCHEMA DO ITEM EXTRAÍDO DO PDF PELA IA
// ==========================================
// Formato solto que vem do GPT-4o-mini (IAService.extractProductsFromPDF).
// Mais tolerante que o createProductSchema: aqui a gente normaliza/coage
// em vez de rejeitar de cara, porque o texto do PDF é ruidoso.
export const pdfImportItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(), // 👈 NOVO CAMPO AQUI
  price: z.number(),
  cost: z.number().optional(),
  stock: z.number(),
  categories: z.array(z.string()),
});

export type PdfImportItem = z.infer<typeof pdfImportItemSchema>;

// ==========================================
// SCHEMAS DE KITS
// ==========================================
export const createKitSchema = z.object({
  name: z.string().min(2),
  slug: z.string(),
  description: z.string().optional(),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: z.number().positive(),
  productItems: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1, 'O kit precisa ter pelo menos 1 produto'),
});

export const kitQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(12),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
});

export const updateKitSchema = createKitSchema.partial();
