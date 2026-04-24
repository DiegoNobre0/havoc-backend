import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';


// Imports dos Schemas
import { 
  idParamSchema, createCategorySchema, updateCategorySchema, 
  productQuerySchema, createProductSchema, updateProductSchema, 
  createKitSchema, 
  kitQuerySchema
} from './catalog.schemas.js';
import { CategoryController } from './categories/category.controller.js';
import { ProductController } from './products/product.controller.js';
import { KitController } from './kits/kit.controller.js';
import { verifyJwt } from '../../shared/middlewares/verify-jwt.js';
import z from 'zod';

// Imports dos Controllers


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
    schema: { tags: ['Catálogo - Categorias'], summary: 'Listar categorias ativas' }
  }, categoryController.list.bind(categoryController));

  app.withTypeProvider<ZodTypeProvider>().post('/categories', {
    schema: { tags: ['Catálogo - Categorias'], body: createCategorySchema }
  }, categoryController.create.bind(categoryController));

  app.withTypeProvider<ZodTypeProvider>().put('/categories/:id', {
    schema: { tags: ['Catálogo - Categorias'], params: idParamSchema, body: updateCategorySchema }
  }, categoryController.update.bind(categoryController));

  app.withTypeProvider<ZodTypeProvider>().delete('/categories/:id', {
    schema: { tags: ['Catálogo - Categorias'], params: idParamSchema }
  }, categoryController.remove.bind(categoryController));


  // ==========================================
  // 📦 ROTAS DE PRODUTOS
  // ==========================================
  app.withTypeProvider<ZodTypeProvider>().get('/products', {
    schema: { tags: ['Catálogo - Produtos'], querystring: productQuerySchema }
  }, productController.list.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().post('/products', {
    schema: { tags: ['Catálogo - Produtos'], body: createProductSchema }
  }, productController.create.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().put('/products/:id', {
    schema: { tags: ['Catálogo - Produtos'], params: idParamSchema, body: updateProductSchema }
  }, productController.update.bind(productController));

  app.withTypeProvider<ZodTypeProvider>().delete('/products/:id', {
    schema: { tags: ['Catálogo - Produtos'], params: idParamSchema }
  }, productController.remove.bind(productController));

  // Rota específica de Upload (Não usa body em JSON, usa Multipart Form-Data)
  app.post('/products/:id/image', {
    schema: { tags: ['Catálogo - Produtos'], summary: 'Upload de imagem (JPEG/PNG/WEBP)' }
  }, productController.uploadImage.bind(productController));


  // ==========================================
  // 🎁 ROTAS DE KITS PROMOCIONAIS
  // ==========================================

  app.withTypeProvider<ZodTypeProvider>().get('/kits', {
    schema: {
      tags: ['Catálogo - Kits'],
      summary: 'Lista kits com paginação',
      querystring: kitQuerySchema
    }
  }, kitController.list.bind(kitController));

  app.withTypeProvider<ZodTypeProvider>().post('/kits', {
    schema: { tags: ['Catálogo - Kits'], body: createKitSchema }
  }, kitController.create.bind(kitController));

  app.withTypeProvider<ZodTypeProvider>().delete('/kits/:id', {
    schema: { tags: ['Catálogo - Kits'], params: idParamSchema }
  }, kitController.remove.bind(kitController));

  app.post('/kits/:id/image', {
    schema: { tags: ['Catálogo - Kits'], summary: 'Upload de foto promocional do Kit (JPEG/PNG/WEBP)' }
  }, kitController.uploadImage.bind(kitController));
}