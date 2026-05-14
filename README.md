# SafeHaven Backend · Delhi Region
**Node.js / Express backend for the SafeHaven Refugee Security Network.**

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. (optional) copy and edit secrets
cp .env.example .env

# 3. Place the frontend HTML next to server.js (or in ./public/)
cp path/to/index.html ./index.html

# 4. Start the server
node server.js
# or with auto-restart on file changes (Node 18+):
node --watch server.js

# 5. Open http://localhost:3000
```

---

## Demo Credentials

| Role              | Worker ID    | Password          | OTP     |
|-------------------|-------------|-------------------|---------|
| Coordinator       | COORD-D101  | SafeHaven@2024    | 482916  |
| Coordinator       | COORD-D098  | SafeHaven@2024    | 482916  |
| Field Worker      | FIELD-D023  | FieldPass#2024    | 739204  |
| Field Worker      | FIELD-D031  | FieldPass#2024    | 739204  |
| UNHCR Admin       | ADMIN-D001  | AdminPass!2024    | 000000  |

### Vetting Keys
| Key                       | Level       |
|---------------------------|-------------|
| `SAFEHAVEN-2024`          | Coordinator |
| `SAFEHAVEN-FIELD-2024`    | Field Worker|
| `SAFEHAVEN-MASTER-2024`   | Admin       |

---

## API Reference

### `GET /api/health`
Returns server status. Used by the frontend to show the green/red backend indicator.

---

### `POST /api/auth/login`
**Body:** `{ workerId, password, role }`  
**Returns:** `{ preToken }` — a 5-minute short-lived token to carry into step 2.

---

### `POST /api/auth/verify-otp`
**Body:** `{ preToken, otp }`  
**Returns:** `{ token, user }` — full 30-minute JWT + user profile.

---

### `POST /api/auth/logout`
**Auth required.**  
Invalidates the JWT session server-side.

---

### `GET /api/locations`
**Auth required.**  
Returns location list. Without a valid `X-Location-Token` header the response is **redacted** (no names, coords, or addresses). With a valid token, full data is returned.

---

### `POST /api/vetting/unlock`
**Auth required.**  
**Body:** `{ key }`  
Validates the vetting key, then returns a scoped `locationToken` (JWT, 30 min).  
Frontend stores this in `locationToken` state and sends it as `X-Location-Token`.

---

### `POST /api/vetting/revoke`
**Auth required.**  
Logs revocation in the audit log (client discards its `locationToken`).

---

### `POST /api/upload`
**Auth required.** `multipart/form-data`, field name `files` (up to 5 files, 10 MB each).  
**Accepted types:** `image/jpeg`, `image/png`, `application/pdf`  
Images are piped through **Sharp** which strips all EXIF metadata (GPS, device ID, timestamps) before saving to `./uploads/`. PDFs are saved as-is with a randomised filename.

---

### `GET /api/audit`
**Auth required, Coordinator+ only.**  
Returns the last 50 audit log entries.

---

### `GET /api/stats`
**Auth required.**  
Returns aggregate stats: total locations, verified centers, active sessions, etc.

---

## Security Architecture

```
Browser                 Backend
  │                        │
  │──POST /api/auth/login──▶ bcrypt verify → preToken (5m JWT)
  │◀── { preToken } ────────│
  │                        │
  │──POST /api/auth/verify-otp ──▶ OTP check → full JWT (30m) + jti in activeSessions
  │◀── { token, user } ─────│
  │                        │
  │──GET /api/locations ───▶ redacted (no X-Location-Token)
  │◀── { locations: [...redacted] }
  │                        │
  │──POST /api/vetting/unlock ──▶ key valid → locationToken (30m JWT)
  │◀── { locationToken } ───│
  │                        │
  │──GET /api/locations (with X-Location-Token) ──▶ full data
  │◀── { locations: [...full] }
```

### Key properties
- **Passwords:** bcrypt (cost factor 10) — no plaintext storage
- **JWT sessions:** jti tracked in `activeSessions` Set; logout invalidates server-side
- **Rate limiting:** auth routes 20 req/15 min, general API 120 req/min
- **File uploads:** Sharp strips all EXIF/GPS before saving; random UUID filenames
- **RBAC:** field < coordinator < admin hierarchy on every protected route

---

## Production Checklist
- [ ] Replace in-memory user/location store with a real DB (Postgres recommended)
- [ ] Set strong random secrets in `.env`
- [ ] Use HTTPS (nginx reverse proxy + Let's Encrypt)
- [ ] Move `activeSessions` Set to Redis for multi-process support
- [ ] Replace static demo OTPs with TOTP (e.g. `speakeasy` library)
- [ ] Add real face-blurring pipeline (Sharp + a face-detection model)
- [ ] Rotate JWT secrets regularly and implement refresh tokens
