# FORM 5 — AI Appendix

## 1. Tool Manifest
- **Model:** Gemini 3.1 Pro (High)
- **Tools Used:** Antigravity Agent tools (`write_to_file`, `run_command`, `list_dir`, `view_file`) within the local workspace IDE.

## 2. AI Tool Usage Approach
The process started by having the AI extract text from the provided PDF and DOCX attachments using a custom Python script. Following this, the AI drafted a comprehensive implementation plan outlining the technology stack (Node.js, Express, TypeScript, PostgreSQL, Prisma, Redis) and the strategies for solving Scenario A (Serverless Data Ingestion) and Scenario B (Flash Sales Cache Invalidation). 
After setting up the foundation (Docker for Postgres/Redis, Prisma schema, server structure), the AI generated the core API endpoints and the background worker architecture using `BullMQ` to handle the heavy read/write operations and cache invalidations asynchronously.

## 3. Judgement, Challenges & Verification

**Limitations & Challenges Handled:**

1. **Prisma 7 Query Engine & Driver Adapter Mismatch:**
   - *Challenge:* In Prisma v7, native Rust binary query engines are removed, requiring active PostgreSQL Pg driver adapters (`@prisma/adapter-pg`) and connection pools. Initially, passing `DATABASE_URL` directly into `schema.prisma` failed in local and alpine environments.
   - *Resolution:* Extracted connection string parameters into `prisma.config.ts` and set up the Pg adapter inside `src/config/prisma.ts` to cleanly bridge the client inside Docker.

2. **Cloudflare Worker Streaming & Queue Serialization Bug (Scenario A):**
   - *Challenge:* The Edge Worker successfully processed high-volume CSV streams, but the initial AI-generated queue logic used `PRODUCT_INGESTION_QUEUE.sendBatch(...)` to split and send individual product objects as separate messages. However, the database consumer worker expected a complete array payload (`message.body` as a chunk). This caused a critical runtime `TypeError: chunk is not iterable` crash during ingestion.
   - *Resolution:* Diagnosed the serialization mismatch. Refactored both the producer chunks and the leftover streams inside `ingest-products-worker.ts` to transmit the entire `currentChunk` array via a single `send()` call, preserving the consumer's high-speed bulk database insertion pipeline.

3. **Dynamic Overlapping Promotion Engine & N+1 Prevention (Scenario B):**
   - *Challenge:* A naive database relation mapping would restrict products to a single active promotion (by assigning a static foreign key on `Product`). This blocked category-wide flash sales and specific product-level campaigns from overlapping.
   - *Resolution:* Completely decoupled the relation. The pricing engine dynamically resolves matching active promotions at query time. To prevent database N+1 performance degradation on bulk lookups, the engine retrieves all matching targets in a single unified SQL query and binds them in-memory (selecting Highest Discount first, and Longest Validity Duration as a tie-breaker).

4. **Docker Container Resolution & TypeScript node16 ESM/CommonJS Mismatch:**
   - *Challenge (Critical Environment Blocker):* This was the most critical blocker preventing local execution. The Node 22 alpine container crashed on launch with a `MODULE_NOT_FOUND` error due to TS compilation issues under strict `verbatimModuleSyntax` and CommonJS vs. ESM mismatches. Simultaneously, the Express service failed to connect to Redis (`ECONNREFUSED`), defaulting to `localhost:6379` instead of routing through the Docker network.
   - *Resolution:* Fixed the compiler pipeline by adjusting `tsconfig.json` to compile into CommonJS using `node16` module resolution (setting `verbatimModuleSyntax` to `false`). Corrected the Redis routing boundary by standardizing environment variables to `REDIS_URL=redis://redis:6379` inside `docker-compose.yml`, successfully uniting all three microservices.

## 4. Overall Reflection
- **Estimated Ratio:** 70% AI Generated / 30% Human Steered (Collaborative debugging of deep compiler issues, refactoring decoupled DB structures, and identifying the worker's queue serialization bug).
- **Key Takeaway:** AI is exceptional at rapid prototyping and scaffolding. However, when complex multi-environment architectures are involved (such as a V8 edge sandbox, container networks, and strict ORM version bumps), human architectural steering is absolutely essential to resolve network isolation issues, memory leaks, and serialization mismatches that would otherwise crash in a production environment.
- **Integration Documentation:** Detailed setup instructions, wrangler queue configurations, Hyperdrive pool settings, and local Docker compose running commands are fully documented in [README.md](./README.md).

