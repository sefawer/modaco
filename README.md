# ModaCo Promotion API & Cloudflare Ingestion Worker

This repository contains the complete, high-performance solution for **ModaCo's Product Catalog & Promotion Management Engine**. It is divided into two highly optimized execution layers designed to satisfy different latency, volume, and environment constraints:

1.  **Scenario A (Massive Data Ingestion - Cloudflare Worker):** A serverless edge architecture using Node.js/TypeScript, Web Streams, Cloudflare Queues, and Cloudflare Hyperdrive to streamingly ingest 500,000+ products under strict serverless execution limits (128MB RAM).
2.  **Scenario B (Flash Sales & Caching - Express API):** A containerized backend powered by Node.js, Express, PostgreSQL (Prisma 7), Redis, and BullMQ to handle real-time cache-aside lookups and asynchronous invalidation during massive flash sales (50,000+ products).

---

## 🛠️ Architecture & Technology Stack

```mermaid
graph TD
    %% Scenario A: Edge Ingestion %%
    subgraph Edge_Ingestion [Scenario A: Edge Ingestion]
        ClientCSV[Client POST CSV Stream] -->|Web Stream| CF_Producer[Cloudflare Ingestion Worker]
        CF_Producer -->|Chunking 500 records| CF_Queue[Cloudflare Queue]
        CF_Queue -->|Async Batch Push| CF_Consumer[Queue Consumer Worker]
        CF_Consumer -->|Pooled Pg Connection| CF_Hyperdrive[Cloudflare Hyperdrive]
    end

    %% Scenario B: Core Backend %%
    subgraph Express_Backend [Scenario B: Core Express Backend]
        UserRequest[Client GET /products] -->|O-1 Cache Lookup| CacheRedis{Redis Cache}
        CacheRedis -->|Hit| ReturnCache[Return Product Catalog]
        CacheRedis -->|Miss| PostgresDB[(PostgreSQL Database)]
        PostgresDB -->|Dynamic Promotion Resolution| CalculatePrices[Calculate Effective Price]
        CalculatePrices -->|Store Cache| CacheRedis
        
        AdminPromo[POST /promotions] -->|1. Store Promo Rule| PostgresDB
        AdminPromo -->|2. Invalidation Event| BullMQ[BullMQ Redis Queue]
        BullMQ -->|Asynchronously Deletes Keys| CacheRedis
    end

    %% Shared Storage %%
    CF_Hyperdrive --> PostgresDB
```

---

## ⚡ Deployment & Setup Guide

### 📦 Prerequisites
- **Node.js:** v22.x or higher
- **Docker & Docker Compose:** Installed and running locally
- **Cloudflare Account:** For wrangler edge deployments (Scenario A)

---

## 🚀 Part 1: Scenario B — Local Express API (Docker environment)

This boots up the complete Postgres, Redis, and Express API local network.

### 1. Boot Environment
Run the compose stack to spin up the Postgres, Redis, and API containers:
```bash
docker compose up --build -d
```

### 2. Database Sync & Migrations
Ensure the Postgres schema is up to date:
```bash
docker compose exec api npx prisma db push
```

### 3. Verification & Seeding
We've included an automated seeder to simulate realistic overlapping category-level (10% off) and product-level ($15 off) promotion conflicts:
```bash
# Seed the database inside the container
docker compose exec api npm run seed
```

### 4. Running Integration Tests
To execute the automated test suite verifying dynamic promotion resolution priority rules and Cache-Aside lookup integrity:
```bash
# Run the automated test suite
docker compose exec api npm run test
```

### 5. Test REST Endpoints
```bash
# Health check
curl http://localhost:3000/health

# Fetch all products with resolved dynamic prices
curl http://localhost:3000/products
```

---

## ☁️ Part 2: Scenario A — Cloudflare Worker Deployment & Setup

The Edge worker processes CSV streams dynamically using **V8 Isolates** and buffers data via **Cloudflare Queues** before writing bulk chunks to PostgreSQL.

### 1. Cloudflare Login & Config
Ensure you are logged into your Cloudflare account:
```bash
npx wrangler login
```

### 2. Create the Cloudflare Queue
Create the ingestion queue bound to your Cloudflare account:
```bash
npx wrangler queues create product-ingestion
```

### 3. Create Cloudflare Hyperdrive
To protect PostgreSQL from concurrent connection exhaustion under high queue consumer traffic, create a **Hyperdrive** connection pooler proxying your production database:
```bash
npx wrangler hyperdrive create modaco-db-pool --connection-string="postgresql://modaco:modaco_password@your-database-host:5432/modaco_db"
```
Copy the returned `id` and paste it into the `wrangler.toml` file:
```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-returned-hyperdrive-id"
```

### 4. Deploy the Edge Worker
Publish your Edge Producer & Consumer worker globally:
```bash
npx wrangler deploy
```

### 5. Test Massive Data Ingestion (Scenario A)
Send a streaming CSV file payload directly to your deployed Cloudflare Worker:
```bash
curl -X POST https://modaco-ingestion-worker.<your-subdomain>.workers.dev \
  -H "Content-Type: text/csv" \
  --data-binary @path/to/large-products.csv
```
*Response is immediate:* `202 Accepted {"message":"Ingestion started and queued successfully."}`. Processing happens safely in the background!

---

## 📐 Dynamic Overlapping Promotion Resolution Rules

Our pricing engine operates under customer-first pricing rules executed dynamically on cache misses or on-the-fly fetches:
1.  **Highest Discount First:** absolute discount amounts are computed dynamically (including converting percentage rules on the fly). The promotion saving the customer the most money wins.
2.  **Longest Duration Tie-breaker:** If discount amounts are equivalent, the promotion with the longest validity window (`endDate - startDate`) overrides to guarantee maximum price stability for the customer.
3.  **Database Efficiency (N+1 Prevention):** Mappings are fetched via a single SQL statement for all retrieved product categories in memory, keeping latency optimal before caching.
