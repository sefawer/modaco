import { Router } from 'express';
import { create, cancel } from '../controllers/promotion.controller';

const router = Router();

router.post('/', create);
router.delete('/:id', cancel);

export default router;
