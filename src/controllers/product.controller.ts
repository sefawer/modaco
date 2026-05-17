import { Request, Response } from 'express';
import { getProducts, getProductById } from '../services/product.service';

export const listProducts = async (req: Request, res: Response) => {
  try {
    const { category, page, limit } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 20;

    const products = await getProducts(category as string, pageNum, limitNum);
    
    res.json({
      data: products,
      page: pageNum,
      limit: limitNum,
      total: products.length // In a real scenario, we'd return actual total count for pagination
    });
  } catch (error) {
    console.error('List products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProductDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await getProductById(id as string);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ data: product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
