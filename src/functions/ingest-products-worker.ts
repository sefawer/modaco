// Type definitions for Cloudflare Workers runtime to prevent TS errors in the Node environment
declare global {
  interface Queue<T = any> {
    send(message: T, options?: { delaySeconds?: number }): Promise<void>;
    sendBatch(messages: Array<{ body: T; delaySeconds?: number }>): Promise<void>;
  }
  interface MessageBatch<T = any> {
    readonly queue: string;
    readonly messages: readonly Message<T>[];
    retryAll(): void;
  }
  interface Message<T = any> {
    readonly id: string;
    readonly timestamp: Date;
    readonly body: T;
    ack(): void;
    retry(): void;
  }
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }
}

import { Client } from 'pg';

export interface Env {
  // Bindings for Cloudflare Queues
  PRODUCT_INGESTION_QUEUE: Queue<any>;
  // Hyperdrive binding for PostgreSQL connection pooling
  HYPERDRIVE: { connectionString: string };
  // Fallback direct database URL
  DATABASE_URL: string;
}

export default {
  /**
   * HTTP Producer: Receives CSV stream, parses it in chunks, and pushes to Cloudflare Queue.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST' || !request.body) {
      return new Response('Bad Request: Expected POST with a body', { status: 400 });
    }

    try {
      console.log('[Worker] Started Massive Data Ingestion via Web Streams');

      const stream = request.body;
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let currentChunk: any[] = [];
      const CHUNK_SIZE = 500;
      let isFirstLine = true;

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let lines = buffer.split('\n');

          // Keep the last partial line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (isFirstLine) {
              isFirstLine = false; // skip header (name,category,sku,base_price,stock_quantity)
              continue;
            }

            const [name, category, sku, base_price, stock_quantity] = trimmedLine.split(',');

            if (!sku || !name) continue; // Skip malformed rows

            currentChunk.push({
              name,
              category,
              sku,
              base_price: parseFloat(base_price || '0'),
              stock_quantity: parseInt(stock_quantity || '0', 10),
            });

            if (currentChunk.length >= CHUNK_SIZE) {
              await env.PRODUCT_INGESTION_QUEUE.send(currentChunk);
              currentChunk = [];
            }
          }
        }

        if (done) {
          // Process remaining data
          if (buffer.trim()) {
            const [name, category, sku, base_price, stock_quantity] = buffer.trim().split(',');
            if (sku && name) {
              currentChunk.push({
                name,
                category,
                sku,
                base_price: parseFloat(base_price || '0'),
                stock_quantity: parseInt(stock_quantity || '0', 10),
              });
            }
          }

          if (currentChunk.length > 0) {
            await env.PRODUCT_INGESTION_QUEUE.send(currentChunk);
          }
          break;
        }
      }

      return new Response(JSON.stringify({ message: 'Ingestion started and queued successfully.' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      console.error('[Worker] Ingestion failed:', error.message);
      return new Response(JSON.stringify({ error: 'Ingestion stream processing failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  /**
   * Queue Consumer: Automatically triggered by Cloudflare Queues to batch process and bulk upsert to DB.
   */
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[Queue Consumer] Received batch of ${batch.messages.length} messages`);

    // Use Hyperdrive pooled connection if available, fallback to direct DATABASE_URL
    const dbUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('Database connection URL not configured in environment bindings');
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    try {
      for (const message of batch.messages) {
        const chunk: any[] = message.body; // Array of product objects
        if (!chunk || chunk.length === 0) continue;

        const values: any[] = [];
        const valuePlaceholders: string[] = [];
        let index = 1;

        for (const item of chunk) {
          valuePlaceholders.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4})`);
          values.push(item.name, item.category, item.sku, item.base_price, item.stock_quantity);
          index += 5;
        }

        // Highly optimized bulk upsert query
        const query = `
          INSERT INTO "Product" (name, category, sku, base_price, stock_quantity)
          VALUES ${valuePlaceholders.join(', ')}
          ON CONFLICT (sku) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            base_price = EXCLUDED.base_price,
            stock_quantity = EXCLUDED.stock_quantity,
            "updatedAt" = NOW()
        `;

        await client.query(query, values);
        message.ack(); // Acknowledge successful processing
      }
    } catch (error: any) {
      console.error('[Queue Consumer] Error during bulk database ingestion:', error.message);
      // Let Cloudflare Queues handle automatic retries for un-acknowledged messages
      throw error;
    } finally {
      ctx.waitUntil(client.end());
    }
  }
};

