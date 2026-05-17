import express from 'express';
import dotenv from 'dotenv';
import { connectRedis } from './config/redis';
import productRoutes from './routes/product.routes';
import promotionRoutes from './routes/promotion.routes';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/products', productRoutes);
app.use('/promotions', promotionRoutes);

app.get('/health', (req, res) => {
  res.send('ModaCo Promotion API is running');
});

const startServer = async () => {
  try {
    await connectRedis();
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

startServer();
