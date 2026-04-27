import { z } from 'zod';

// Parametros comuns
export const idParamSchema = z.object({
  id: z.string().uuid()
});

// ==========================================
// SCHEMAS DE CATEGORIA
// ==========================================
export const createCategorySchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  slug: z.string().min(2, "Slug inválido"),
  description: z.string().optional()
});

export const updateCategorySchema = createCategorySchema.partial();

// ==========================================
// SCHEMAS DE PRODUTO
// ==========================================
export const productQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(12),
  search: z.string().optional(),
  categoryIds: z.array(z.string().uuid()).optional()

});

export const createProductSchema = z.object({
  name: z.string().min(2),
  slug: z.string(),
  description: z.string().optional(),
  price: z.number().positive("O preço deve ser maior que zero"),
  stock: z.number().int().min(0),
  categoryIds: z.array(z.string().uuid())
});

export const updateProductSchema = createProductSchema.partial();

// ==========================================
// SCHEMAS DE KITS
// ==========================================
export const createKitSchema = z.object({
  name: z.string().min(2),
  slug: z.string(),
  description: z.string().optional(),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: z.number().positive(),
  productItems: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1)
  })).min(1, "O kit precisa ter pelo menos 1 produto")
});

export const kitQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(12),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional()
});


export const updateKitSchema = createKitSchema.partial();