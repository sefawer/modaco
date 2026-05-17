# Architecture Decision Record (ADR) - ModaCo Promotion API

## 1. Context and Problem Statement
ModaCo requires a resilient API to manage their product catalog and promotions. The system has two primary architectural challenges:
- **Scenario A (Massive Data Ingestion):** Weekly ingestion of 500,000+ rows under strict Serverless limits (Timeout, RAM).
- **Scenario B (Flash Sales):** Real-time heavy read/write loads affecting 50,000+ products simultaneously without causing bottlenecks.

## 2. Technology Stack Selection
- **Node.js, Express, TypeScript:** Required by the case study. Provides strong typing and high async concurrency for the main API.
- **PostgreSQL:** Selected for structured relational data. Products and Promotions have strong relational integrity, and standard ACID compliance is essential for transactional consistency.
- **Redis:** Selected as the high-speed caching layer. Crucial for Scenario B to prevent DB read-locks and overhead during high-traffic GET requests.
- **Prisma ORM:** Chosen for type-safe database access and fast iteration in the Express backend.
- **BullMQ:** Selected as a Redis-backed queue to manage asynchronous, distributed background jobs (specifically Category-level Cache Invalidation in Scenario B).
- **Cloudflare Workers & Queues:** Added to handle Scenario A. Executes V8 isolates at the Edge with native Web Streams for high-performance memory-flat parsing and serverless at-least-once queue distribution.
- **Cloudflare Hyperdrive:** Used to pool and proxy PostgreSQL database connections globally, shielding the DB from being overwhelmed by concurrent Worker queue consumers.


## 3. Architecture for Scenario A: "Massive Data Ingestion"
### Approach: Web Streams and Cloudflare Queues in Workers
**Decision:** We avoid loading the entire 500k row CSV into memory due to the strict 128MB RAM limit of Cloudflare Workers. Instead, we utilize the Web Streams API (`ReadableStream` and `TransformStream`) to parse the CSV on the fly within the edge worker.
1. The Cloudflare Worker receives the HTTP POST request containing the CSV file stream.
2. It processes the stream using a `TransformStream` to parse the CSV and batches records into chunks (e.g., 500 rows).
3. Once a chunk is full, it is published directly to **Cloudflare Queues**.
4. The HTTP response immediately returns `202 Accepted` to the client.
5. A separate Cloudflare Queue Consumer Worker, which has relaxed execution limits (up to 15 minutes of execution time), consumes these messages in batches.
6. The Consumer Worker connects to the PostgreSQL database using **Cloudflare Hyperdrive** (to maintain connection pooling globally) and performs bulk `upsert` transactions.

### Trade-offs:
- **Pros:** RAM usage stays well below the 128MB limit (only the current chunk is in memory). Bypasses the 50ms CPU time limit of standard HTTP workers. Cloudflare Queues guarantee at-least-once delivery. Connection pooling is managed efficiently via Hyperdrive, preventing database connection exhaustion from many queue consumers.
- **Cons:** Eventual consistency. The data isn't instantly available in the DB the moment the API returns 202. Local testing of Cloudflare Queues requires specific wrangler configurations compared to a simple local Redis-backed queue.

## 4. Architecture for Scenario B: "Flash Sales"
### Approach: Cache-Aside with Asynchronous Invalidation
**Decision:** We implement a heavy caching layer for `GET /products`.
1. **Reads:** `GET /products` requests are intercepted by Redis. If a valid cache exists, it's returned immediately (O(1) operation), completely bypassing PostgreSQL.
2. **Writes (Promotions):** When a Flash Sale is created affecting an entire category, updating 50,000 rows in PostgreSQL synchronously would crash the system. Instead, the API saves the Promotion rule and fires an event to `BullMQ`.
3. **Invalidation:** A background worker listens to this event and deletes/invalidates the specific Redis keys (`products:category:X:*` or `products:all:*`).
4. **New Products:** When a new product is added during a flash sale, the `getProducts` service dynamically evaluates category-level promotions that are active, calculating the effective price on the fly before caching it.

### Trade-offs:
- **Pros:** Massive read scalability. Database is shielded from traffic spikes.
- **Cons:** Requires strict cache invalidation logic, otherwise users might see stale prices.

## 5. Merging "Create" and "Assign" Operations
### Approach: Atomic Creation and Assignment for Promotions
**Decision:** The endpoint `POST /promotions` handles both the creation of the promotion rule and its assignment to a specific `target_type` (Product or Category) and `target_id` simultaneously.

### Trade-offs:
- **Pros:** 
  - Extremely beneficial for **Scenario B (Flash Sales)**. When a flash sale is created, it is instantly assigned to a category and triggers the cache invalidation queue in a single atomic transaction.
  - Prevents "orphan" promotions (promotions without a target) from cluttering the database by enforcing `NOT NULL` constraints on the target fields.
- **Cons:** 
  - Reduced flexibility. A promotion cannot be created as a "template" (e.g., "Generic Summer Discount") to be repeatedly assigned to different targets later. Each assignment requires creating a new promotion record. This trade-off was accepted to prioritize the speed and atomicity required by the flash sale scenario.

## 6. Dynamic Overlapping Promotion Resolution
### Approach: Decoupled Schema and Client-Friendly Priority Engine
**Decision:** We avoid storing a static `active_promotion_id` inside the `Product` table. Doing so creates a structural bottleneck that prevents a single product from being eligible for multiple concurrent promotions (e.g., Category-level and Product-level). Instead, all eligible promotions are fetched dynamically at query-time and resolved using a customer-friendly prioritization algorithm:
1. **Highest Discount Amount:** The promotion providing the largest absolute discount to the customer wins (converting percentages to absolute values dynamically).
2. **Longer Total Duration:** If discount amounts are equal, the promotion with the longer total duration (`end_date - start_date`) wins to guarantee pricing stability.
3. **Compound Indexing:** To prevent slow dynamic query lookups, the `Promotion` table is indexed on `(target_type, target_id)` and `(start_date, end_date)`.
4. **N+1 Query Prevention:** When listing products, we retrieve all eligible promotions for the entire page of products in a single SQL query, separating and matching them in memory to maintain O(1) database query complexity.

### Trade-offs:
- **Pros:** 
  - **Maximum Flexibility:** Products can participate in brand, category, and direct flash sale discounts concurrently without requiring database updates.
  - **Customer First:** Pricing logic consistently and predictably selects the absolute best deal for the user.
- **Cons:** 
  - Slightly increased application-layer computation. However, this computation is performed only on cache-misses before being persisted to Redis, keeping production API response times extremely low.

## 7. Cloudflare Workers Integration & Deployment Guidance
### Approach: Actionable Setup and Secrets Management
**Decision:** Because Cloudflare Workers run in a distinct V8 isolate sandbox compared to the containerized Express node environment, setting up local queues, Hyperdrive proxying, and wrangler bindings requires specific CLI commands and configurations.
- We have documented the exact step-by-step setup guides, queue creation instructions, Hyperdrive provisioning steps, and deployment script targets inside the main [README.md](./README.md).
- Developers should consult [README.md](./README.md) to initialize the Cloudflare CLI, provision wrangler bindings, manage secrets, and publish the `ingest-products-worker.ts` serverless environment.

