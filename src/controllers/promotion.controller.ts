import { Request, Response } from 'express';
import { createPromotion, cancelPromotion } from '../services/promotion.service';

export const create = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const promotion = await createPromotion(data);
    res.status(201).json({ data: promotion });
  } catch (error: any) {
    console.error('Create promotion error:', error);
    res.status(400).json({ error: error.message || 'Bad request' });
  }
};

export const cancel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await cancelPromotion(id as string);
    res.json({ message: 'Promotion cancelled successfully' });
  } catch (error: any) {
    console.error('Cancel promotion error:', error);
    res.status(400).json({ error: error.message || 'Bad request' });
  }
};
