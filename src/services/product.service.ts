import prisma from '../config/prisma';
import { getCache, setCache } from './cache.service';
import { Promotion, DiscountType } from '@prisma/client';

/**
 * Dynamically resolves overlapping promotions and calculates the effective price.
 * 
 * Rules:
 * 1. Only active promotions (within start_date and end_date) are evaluated.
 * 2. Highest absolute discount amount wins.
 * 3. If discount amounts are equal, the one with the longer total duration wins.
 */
export const calculateEffectivePriceAndPromotion = (basePrice: number, promotions: Promotion[]) => {
  if (promotions.length === 0) {
    return { effectivePrice: basePrice, appliedPromotion: null };
  }

  const now = new Date();
  
  // Filter active promotions
  const activePromotions = promotions.filter(
    p => now >= new Date(p.start_date) && now <= new Date(p.end_date)
  );

  if (activePromotions.length === 0) {
    return { effectivePrice: basePrice, appliedPromotion: null };
  }

  // Map each promotion to its discount amount and total duration
  const evaluated = activePromotions.map(p => {
    let discountAmount = 0;
    if (p.discount_type === DiscountType.PERCENTAGE) {
      discountAmount = basePrice * (p.value / 100);
    } else if (p.discount_type === DiscountType.FIXED) {
      discountAmount = Math.min(basePrice, p.value); // Prevent negative price
    }

    const duration = new Date(p.end_date).getTime() - new Date(p.start_date).getTime();

    return {
      promotion: p,
      discountAmount,
      duration
    };
  });

  // Sort promotions:
  // 1. Highest discount amount first
  // 2. Longer duration first
  evaluated.sort((a, b) => {
    if (Math.abs(a.discountAmount - b.discountAmount) > 0.0001) {
      return b.discountAmount - a.discountAmount; // Descending by discount amount
    }
    return b.duration - a.duration; // Descending by duration
  });

  const winningEvaluated = evaluated[0]!;
  const effectivePrice = Math.max(0, basePrice - winningEvaluated.discountAmount);

  return {
    effectivePrice,
    appliedPromotion: winningEvaluated.promotion
  };
};

export const getProducts = async (category?: string, page: number = 1, limit: number = 20) => {
  const cacheKey = `products:${category || 'all'}:${page}:${limit}`;
  
  const cachedProducts = await getCache(cacheKey);
  if (cachedProducts) {
    return cachedProducts;
  }

  const skip = (page - 1) * limit;
  const whereClause = category ? { category } : {};

  // Fetch products
  const products = await prisma.product.findMany({
    where: whereClause,
    skip,
    take: limit
  });

  if (products.length === 0) {
    return [];
  }

  // Fetch all active promotions that target the category OR specific product IDs
  const activePromotions = await prisma.promotion.findMany({
    where: {
      OR: [
        { target_type: 'CATEGORY', target_id: { in: products.map(p => p.category) } },
        { target_type: 'PRODUCT', target_id: { in: products.map(p => p.id) } }
      ],
      start_date: { lte: new Date() },
      end_date: { gte: new Date() }
    }
  });

  // Separate promotions for quick matching
  const categoryPromotions = activePromotions.filter(p => p.target_type === 'CATEGORY');
  const productPromotions = activePromotions.filter(p => p.target_type === 'PRODUCT');

  const formattedProducts = products.map(product => {
    // Gather all eligible promotions for this specific product
    const eligiblePromotions = [
      ...productPromotions.filter(p => p.target_id === product.id),
      ...categoryPromotions.filter(p => p.target_id === product.category)
    ];

    const { effectivePrice, appliedPromotion } = calculateEffectivePriceAndPromotion(
      product.base_price,
      eligiblePromotions
    );

    return {
      ...product,
      effective_price: effectivePrice,
      applied_promotion: appliedPromotion ? {
        id: appliedPromotion.id,
        name: appliedPromotion.name,
        discount_type: appliedPromotion.discount_type,
        value: appliedPromotion.value
      } : null
    };
  });

  // Sort by effective price ascending as requested in core expectations
  formattedProducts.sort((a, b) => a.effective_price - b.effective_price);

  await setCache(cacheKey, formattedProducts, 300); // cache for 5 mins

  return formattedProducts;
};

export const getProductById = async (id: string) => {
  const cacheKey = `product:${id}`;
  
  const cachedProduct = await getCache(cacheKey);
  if (cachedProduct) {
    return cachedProduct;
  }

  const product = await prisma.product.findUnique({
    where: { id }
  });

  if (!product) return null;

  // Fetch all active promotions targeting this specific product or its category
  const eligiblePromotions = await prisma.promotion.findMany({
    where: {
      OR: [
        { target_type: 'PRODUCT', target_id: product.id },
        { target_type: 'CATEGORY', target_id: product.category }
      ],
      start_date: { lte: new Date() },
      end_date: { gte: new Date() }
    }
  });

  const { effectivePrice, appliedPromotion } = calculateEffectivePriceAndPromotion(
    product.base_price,
    eligiblePromotions
  );

  const result = {
    ...product,
    effective_price: effectivePrice,
    applied_promotion: appliedPromotion ? {
      id: appliedPromotion.id,
      name: appliedPromotion.name,
      discount_type: appliedPromotion.discount_type,
      value: appliedPromotion.value
    } : null
  };

  await setCache(cacheKey, result, 300);
  return result;
};

