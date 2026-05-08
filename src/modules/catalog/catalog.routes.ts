import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

// Imports dos Schemas
import {
  idParamSchema, createCategorySchema, updateCategorySchema,
  productQuerySchema, createProductSchema, updateProductSchema,
  createKitSchema,
  kitQuerySchema,
  updateKitSchema
} from './catalog.schemas.js';

// Imports dos Controllers
import { CategoryController } from './categories/category.controller.js';
import { ProductController } from './products/product.controller.js';
import { KitController } from './kits/kit.controller.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';

export async function catalogRoutes(app: FastifyInstance) {
  // Instância dos Controllers
  const categoryController = new CategoryController();
  const productController = new ProductController();
  const kitController = new KitController();

  // Middleware de Autenticação (Protege todas as rotas de catálogo)
  app.addHook('onRequest', verifyJwt);

  // ==========================================
  // 🏷️ ROTAS DE CATEGORIA
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().get('/categories', {
    schema: { tags: ['Catálogo - Categorias'], summary: 'Lista todas as categorias ativas' }
  }, categoryController.list.bind(categoryController));

  app.withTypeProvider<ZodTypeProvider>().post('/categories', {
    schema: { tags: ['Catálogo - Categorias'], summary: 'Cria uma nova categoria', body: createCategorySchema }
  }, categoryController.create.bind(categoryController));

  app.withTypeProvider<ZodTypeProvider>().put('/categories/:id', {
    schema: { tags: ['Catálogo - Categorias'], summary: 'Atualiza os dados de uma categoria', params: idParamSchema, body: updateCategorySchema }
  }, categoryController.update.bind(categoryController));

  app.withTypeProvider<ZodTypeProvider>().delete('/categories/:id', {
    schema: { tags: ['Catálogo - Categorias'], summary: 'Remove uma categoria (Soft Delete)', params: idParamSchema }
  }, categoryController.remove.bind(categoryController));


  // ==========================================
  // 📦 ROTAS DE PRODUTOS
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().get('/products', {
    schema: { tags: ['Catálogo - Produtos'], summary: 'Lista os produtos com paginação e filtros', querystring: productQuerySchema }
  }, productController.list.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().post('/products', {
    schema: { tags: ['Catálogo - Produtos'], summary: 'Cria um novo produto', body: createProductSchema }
  }, productController.create.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().put('/products/:id', {
    schema: { tags: ['Catálogo - Produtos'], summary: 'Atualiza os dados de um produto', params: idParamSchema, body: updateProductSchema }
  }, productController.update.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().delete('/products/:id', {
    schema: { tags: ['Catálogo - Produtos'], summary: 'Remove um produto (Soft Delete)', params: idParamSchema }
  }, productController.remove.bind(productController));

  // Rota específica de Upload (Não usa body em JSON, usa Multipart Form-Data)
  app.post('/products/:id/image', {
    schema: { tags: ['Catálogo - Produtos'], summary: 'Upload da imagem principal do produto (JPEG/PNG)' }
  }, productController.uploadImage.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().patch('/products/:id/status', {
    schema: {
      tags: ['Catálogo - Produtos'],
      summary: 'Ativa ou desativa a exibição de um produto',
      params: idParamSchema,
    }
  }, productController.toggleStatus.bind(productController));


  // ==========================================
  // 🎁 ROTAS DE KITS PROMOCIONAIS
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().get('/kits', {
    schema: {
      tags: ['Catálogo - Kits'],
      summary: 'Lista os kits promocionais com paginação',
      querystring: kitQuerySchema
    }
  }, kitController.list.bind(kitController));

  app.withTypeProvider<ZodTypeProvider>().post('/kits', {
    schema: { tags: ['Catálogo - Kits'], summary: 'Cria um novo kit promocional com vários itens', body: createKitSchema }
  }, kitController.create.bind(kitController));

  app.withTypeProvider<ZodTypeProvider>().delete('/kits/:id', {
    schema: { tags: ['Catálogo - Kits'], summary: 'Remove um kit promocional', params: idParamSchema }
  }, kitController.remove.bind(kitController));

  app.withTypeProvider<ZodTypeProvider>().put('/kits/:id', {
    schema: { tags: ['Catálogo - Kits'], summary: 'Atualiza os dados e os itens de um kit', params: idParamSchema, body: updateKitSchema }
  }, kitController.update.bind(kitController));

  app.post('/kits/:id/image', {
    schema: { tags: ['Catálogo - Kits'], summary: 'Upload de foto promocional do Kit (JPEG/PNG)' }
  }, kitController.uploadImage.bind(kitController));

  app.withTypeProvider<ZodTypeProvider>().patch('/kits/:id/status', {
    schema: {
      tags: ['Catálogo - Kits'],
      summary: 'Ativa ou desativa a exibição de um kit',
      params: idParamSchema,
      body: z.object({
        isActive: z.boolean()
      })
    }
  }, kitController.toggleStatus.bind(kitController));
}