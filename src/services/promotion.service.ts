import prisma from '../config/prisma';
import { promotionQueue } from './queue.service';
import { DiscountType, TargetType } from '@prisma/client';

export const createPromotion = async (data: {
  name: string;
  discount_type: DiscountType;
  value: number;
  start_date: string;
  end_date: string;
  target_type: TargetType;
  target_id: string; // Product ID or Category Name
}) => {
  const promotion = await prisma.promotion.create({
    data: {
      name: data.name,
      discount_type: data.discount_type,
      value: data.value,
      start_date: new Date(data.start_date),
      end_date: new Date(data.end_date),
      target_type: data.target_type,
      target_id: data.target_id,
    }
  });



  // Queue background job for cache invalidation (Flash Sale Scenario B)
  await promotionQueue.add('apply-promotion', {
    action: 'APPLY_PROMOTION',
    target_type: data.target_type,
    target_id: data.target_id,
    promotion_id: promotion.id
  });

  return promotion;
};

export const cancelPromotion = async (id: string) => {
  const promotion = await prisma.promotion.delete({
    where: { id }
  });

  // Queue background job for cache invalidation and removing references
  await promotionQueue.add('cancel-promotion', {
    action: 'CANCEL_PROMOTION',
    promotion_id: id
  });

  return promotion;
};
