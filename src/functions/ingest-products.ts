import { Queue } from 'bullmq';
import csvParser from 'csv-parser';
import { Readable } from 'stream';

// In a real Serverless environment (like Azure Functions), this would be the function entry point.
// We are simulating an HTTP trigger that accepts a CSV file stream.
// Due to 500k rows and memory limits, we pipe the stream directly into the parser and queue chunks.

const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const ingestionQueue = new Queue('product-ingestion', { connection: redisOptions });

const CHUNK_SIZE = 500;

export const ingestProductsHandler = async (req: any, res: any) => {
  try {
    console.log('[Serverless] Started Massive Data Ingestion');

    let currentChunk: any[] = [];
    
    // Using req as a readable stream (e.g. if the file is streamed via HTTP or from an S3 object stream)
    req
      .pipe(csvParser())
      .on('data', (data: any) => {
        currentChunk.push({
          name: data.name,
          category: data.category,
          sku: data.sku,
          base_price: parseFloat(data.base_price),
          stock_quantity: parseInt(data.stock_quantity, 10),
        });

        if (currentChunk.length >= CHUNK_SIZE) {
          // Pause stream to prevent memory overflow while adding to queue
          req.pause();
          
          ingestionQueue.add('process-chunk', { items: currentChunk })
            .then(() => {
              currentChunk = [];
              req.resume();
            })
            .catch((err) => {
              console.error('Failed to queue chunk', err);
              req.resume();
            });
        }
      })
      .on('end', async () => {
        if (currentChunk.length > 0) {
          await ingestionQueue.add('process-chunk', { items: currentChunk });
        }
        res.status(202).json({ message: 'Ingestion started and queued successfully.' });
      })
      .on('error', (err: any) => {
        console.error('[Serverless] Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream processing failed' });
        }
      });

  } catch (error) {
    console.error('[Serverless] Ingestion failed:', error);
    res.status(500).json({ error: 'Ingestion initialization failed' });
  }
};
