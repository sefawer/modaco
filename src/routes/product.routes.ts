import { Router } from 'express';
import { listProducts, getProductDetails } from '../controllers/product.controller';

const router = Router();

router.get('/', listProducts);
router.get('/:id', getProductDetails);

export default router;
