# Leave Approval API

[![CI](https://github.com/loveyrak-lab/leave-approval/actions/workflows/ci.yml/badge.svg)](https://github.com/loveyrak-lab/leave-approval/actions/workflows/ci.yml)

A REST API for requesting and approving employee leave, built with TypeScript, Express and PostgreSQL. Employees submit leave requests, their manager approves or rejects them, and the system enforces leave balances, overlapping dates and role-based access.

## Features

- Login with JWT; passwords are hashed with scrypt and a per-user salt.
- Three roles: `EMPLOYEE`, `MANAGER`, `ADMIN`, each with different permissions.
- Leave types with yearly allowances (annual, sick, personal) and a per-employee balance endpoint.
- Working-day calculation: weekends are not counted against the balance.
- Approve, reject and cancel flows with a clear status lifecycle: `PENDING` -> `APPROVED` / `REJECTED` / `CANCELLED`.

## Tech stack

| Layer | Technology |
| --- | --- |
| Language / runtime | TypeScript, Node.js 22 |
| Web framework | Express 5 |
| Database | PostgreSQL 16 (Docker Compose) |
| Auth | JWT (`jsonwebtoken`), scrypt password hashing |
| Migrations | Plain SQL files with a small runner (`schema_migrations` table) |
| Tests | Vitest, Supertest, Testcontainers |
| CI / packaging | GitHub Actions, multi-stage Dockerfile |

## Business rules

- A request cannot be in the past, cannot span two calendar years, and must contain at least one working day.
- **No overlapping leave:** enforced by the database with an exclusion constraint on `daterange(start_date, end_date, '[]')` (`btree_gist`) for `PENDING` and `APPROVED` requests, so it holds even when two requests arrive at the same instant. The API returns `409 Conflict`.
- **Balance:** a request that would exceed the remaining allowance for that leave type and year is rejected with `422`. The balance check runs in a transaction with a row lock (`SELECT ... FOR UPDATE`) so concurrent requests cannot both slip under the limit.
- **Decisions are atomic:** approving or rejecting uses `UPDATE ... WHERE status = 'PENDING' RETURNING`, so a request can only be decided once (a second attempt gets `409`).
- **Separation of duties:** nobody can approve their own request; only the requester's manager (or an admin) can decide it.
- **Status codes:** `401` not logged in, `403` logged in but not allowed, `409` conflict with current state, `422` valid request that breaks a business rule.
- Dates are handled as plain `YYYY-MM-DD` text and "today" is computed in `Asia/Bangkok`, which avoids time-zone shifts.

## API overview

All endpoints except `/health` and `/auth/login` require `Authorization: Bearer <token>`.

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| GET | `/health` | public | Service and database check |
| POST | `/auth/login` | public | Exchange email and password for a JWT |
| GET | `/auth/me` | any | Current user |
| GET | `/leave-types` | any | Leave types and yearly allowances |
| GET | `/employees` | manager, admin | Admin: everyone. Manager: self and direct reports |
| POST | `/employees` | admin | Create an employee |
| GET | `/employees/:id/balance?year=` | self, their manager, admin | Allowance, used and remaining per leave type |
| POST | `/leave-requests` | any | Submit a request (`leaveTypeCode`, `startDate`, `endDate`, `reason`) |
| GET | `/leave-requests` | any | Employee: own. Manager: own and direct reports. Admin: all |
| POST | `/leave-requests/:id/approve` | manager, admin | Approve a pending request |
| POST | `/leave-requests/:id/reject` | manager, admin | Reject a pending request |
| POST | `/leave-requests/:id/cancel` | owner | Cancel a pending or approved request that has not ended |

## Running locally

Prerequisites: Node.js 22 and Docker Desktop.

```bash
docker compose up -d      # PostgreSQL on port 5433
npm install
npm run migrate           # create / update the schema
npm run dev               # API on http://localhost:3000
```

Create users with the `create-user` script (see `src/createUser.ts`), then log in at `POST /auth/login`.

Configuration is read from environment variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `PORT`. In production (`NODE_ENV=production`) the app refuses to start without `JWT_SECRET`.

> The database credentials in `docker-compose.yml` are for local development only.

## Testing

```bash
npm test
```

- Unit tests cover date parsing and working-day counting.
- Integration tests start a throw-away PostgreSQL 16 with Testcontainers, apply the real migrations and call the API through Supertest. They cover overlapping dates, quota limits, role permissions, self-approval, double approval and balance visibility.

Docker must be running. GitHub Actions runs the same tests on every push.

## Running in a container

```bash
docker build -t leave-approval .
docker run -p 3000:3000 \
  -e DB_HOST=host.docker.internal -e DB_PORT=5433 \
  -e JWT_SECRET=choose-a-long-random-secret \
  leave-approval
```

The container applies pending migrations on start and then launches the server. No secrets are baked into the image.

## Known limitations and roadmap

- The role is stored in the JWT, so a role change only takes effect after the token expires (8 hours). Loading the role from the database on each request would fix this.
- No rate limiting on login yet.
- Public holidays are not excluded from working days; half-day leave is not supported.
- No frontend yet.
