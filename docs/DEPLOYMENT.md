# Deployment Guide - Vault Poker

## Prerequisites
- **Java 25+** (for the backend)
- **Node.js 24+** (for the frontend)
- **Maven** (optional, `./mvnw` provided)

## Backend Deployment (Spring Boot)

### 1. Configuration
Ensure the following environment variables are set in your production environment:
- `JWT_SECRET`: A secure, base64-encoded string (at least 64 characters).
- `PORT`: (Optional) Defaults to 8080.

### 2. Build and Run
```bash
./mvnw clean package
java -jar target/Poker-0.0.1-SNAPSHOT.jar
```

## Frontend Deployment (Vite + Tailwind v4)

### 1. Configuration
The frontend is configured to use relative paths for API and WebSocket by default. If your API is on a different domain, set:
- `VITE_API_BASE_URL`: e.g., `https://api.vaultpoker.com`

### 2. Build
```bash
npm install
npm run build
```
This will generate a `dist/` directory containing static assets.

### 3. Serving
Serve the contents of the `dist/` directory using a web server (e.g., Nginx, Apache).
Ensure your server is configured to route all unknown paths to `index.html` (Single Page Application routing).

### 4. Production Security Headers
We recommend the following security headers in your production server configuration:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

## Integration
Ensure the frontend is allowed to connect to the backend's `/ws` endpoint via your proxy/load balancer, and that WebSocket upgrades are supported.

## 🧪 Pre-Deployment Verification
Before pushing updates to production, it is critical to verify the entire system's integrity by running the unified test command. This validates all user-centric behavioral tests and Playwright E2E browser flows:

```bash
# Run the complete test pipeline (Unit, Integration, and E2E)
npm run test:all
```

Ensure that all **18 passing test files (77 Vitest cases)** and all **6 E2E Playwright scenarios** complete with a `PASS` status and zero console warnings.

