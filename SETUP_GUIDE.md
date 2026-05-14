# SafeHaven Backend-Frontend Connection Guide

## ✅ Status
The **frontend and backend are now connected** via the `index.html` file and `server.js`.

## How It Works

1. **Backend Server** (`server.js`): Runs on `localhost:3000` and provides API endpoints
   - `/api/health` - Server health check
   - `/api/auth/login` - Authentication
   - `/api/auth/verify-otp` - 2FA verification
   - And more API endpoints

2. **Frontend** (`index.html`): Served by the server on the same origin
   - Makes fetch requests to `/api/*` endpoints
   - Communicates with the backend automatically

## Starting the Application

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start the Server
```bash
npm start
# Or for development with auto-reload:
npm run dev
```

### Step 3: Open in Browser
Navigate to: **http://localhost:3000**

You should see:
- ✅ A green "BACKEND CONNECTED" indicator (top of login form)
- Login form ready for authentication

## Demo Credentials

| Field | Value |
|-------|-------|
| Worker ID | `COORD-D101` |
| Password | `SafeHaven@2024` |
| Role | `Coordinator` |
| 2FA Code | `482916` |

## What Changed

- ✅ Created `index.html` - Now served by the backend server
- ✅ Server.js already configured to serve static files
- ✅ Frontend and backend are now on the same origin (no CORS issues)
- ✅ API calls work through relative paths (`/api/*`)

## File Organization

```
d:\safeheaven\
├── server.js              (Backend API server)
├── index.html            (Frontend - now served by server)
├── package.json          (Dependencies & scripts)
├── safe heaven front end.html  (Old test file)
└── testing backend.html        (Old test file)
```

## Troubleshooting

### "BACKEND OFFLINE" indicator
- Ensure `npm start` is running
- Check that port 3000 is available
- Try: `netstat -ano | findstr 3000` (Windows)

### Port 3000 already in use
```bash
# On Windows, find and kill the process:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### API calls failing
- Make sure you're accessing `http://localhost:3000` (not the file path)
- Check the browser console for errors (F12 > Console tab)

## Production Deployment

Before deploying:
1. Update JWT secrets in `.env` (use strong random values)
2. Switch from in-memory data store to a real database
3. Configure CORS appropriately
4. Enable HTTPS/TLS

See `.env.example` for environment variable setup.
