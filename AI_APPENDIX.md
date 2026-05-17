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
   - *Challenge:* When utilizing Prisma v7, the native Rust binary query engines are removed, requiring Pg driver adapters (`@prisma/adapter-pg`) and connection pools to instantiate the database client. Initially, passing `DATABASE_URL` directly into `schema.prisma` was rejected.
   - *Resolution:* Moved database connection pooling logic out of the schema into `prisma.config.ts` and set up Pg connection adapters in `src/config/prisma.ts` to seamlessly manage pooled Postgres execution inside docker containers.

2. **Serverless Streaming Data Ingestion (Scenario A):**
   - *Challenge:* The standard model approach was a single generic bulk payload insert, which violates RAM and Execution timeout bounds in serverless functions (like Cloudflare Workers / Azure Functions).
   - *Resolution:* Configured the pipeline to parse files on the fly via `csv-parser` web streams, piping batched chunks (500 records) into message queue segments to distribute and scale consumers with zero flat memory footprints.

3. **Dynamic Overlapping Promotion Resolution & Decoupling (Scenario B):**
   - *Challenge:* Naively assigning an `active_promotion_id` relation directly to the `Product` table limited products to a single concurrent discount. It prevented overlapping category-level and direct flash sale campaigns from existing concurrently.
   - *Resolution:* Decoupled pricing relations completely. The engine dynamically queries active promotions, applying custom prioritization logic in memory (Highest Discount Amount wins -> Longer Promotion Duration wins). 
   - *N+1 Prevention:* Prevented massive SQL database access loops by querying all active promotion targets for a page's products in a single SQL operation, resolving mappings in memory to preserve O(1) query complexity.

4. **Docker Network Mismatches & TypeScript node16 Compilation Resolvers:**
   - *Challenge:* TypeScript verbatim module imports crashed under CommonJS outputs in alpine containers. Additionally, the Express API defaulted to `localhost:6379` for Redis, causing container isolation `ECONNREFUSED` connection crashes.
   - *Resolution:* Standardized TS configuration under Node16 module resolutions (verbatimModuleSyntax: false) and injected docker service hosts (`REDIS_URL=redis://redis:6379`) to allow seamless inter-container routing.

## 4. Overall Reflection
- **Estimated Ratio:** 75% AI Generated / 25% Human Steered (Collaborative pairing on resolving strict compiler settings, refactoring Decoupled pricing tables, and container network debugging).
- **Key Takeaway:** While AI tools excel at accelerating boilerplate creation, database migrations, and structural scaffolding, human oversight is crucial when designing high-throughput overlapping algorithms or troubleshooting environment-specific network topology.
- **Integration Documentation:** To guarantee successful deployment, we have provided comprehensive step-by-step setup instructions for both local Docker setups and global Cloudflare Worker deployments (Queues, Hyperdrive) in the main [README.md](./README.md) file.

