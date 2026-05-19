# Ngrok and local development (Food Delivery app)

This guide is for when you open the project again and need a **public HTTPS URL** to your PC (mainly for **M-Pesa Daraja callbacks** and testing on your phone). The API and env file live under **`backend/`**.

---

## What you need installed

- **Node.js** (for `node server.js`)
- **MySQL** running (e.g. XAMPP), with your database and `backend/.env` filled in
- **ngrok** — either:
  - `ngrok.exe` in your `backend` folder (or elsewhere), or
  - ngrok on your PATH from [https://ngrok.com/download](https://ngrok.com/download)

One-time setup: create a free account at [https://dashboard.ngrok.com](https://dashboard.ngrok.com), copy your **authtoken**, then run:

```powershell
ngrok config add-authtoken YOUR_TOKEN_HERE
```

(If you use a local `ngrok.exe`, run that command with the full path to the executable.)

---

## Important: which `.env` file?

**Only `backend/.env` is loaded** by the server (`server.js` uses `path.join(__dirname, '.env')`).  
Changes in the **repo root** `.env` do **not** affect the API unless you copy values into `backend/.env`.

After any edit to `backend/.env`, **restart** the Node process.

---

## Every time you come back — step by step

### 1. Start MySQL

Start MySQL (e.g. from XAMPP Control Panel).

### 2. Start the backend

```powershell
cd "C:\Users\hp\my projects\food-delivery-app\backend"
node server.js
```

Leave this terminal open. Default port is **3000** (or whatever you set in `backend/.env` as `PORT`).

You should see logs like **Database: MySQL** and **M-Pesa: Daraja STK push enabled** (if M-Pesa vars are set).

### 3. Start ngrok in a second terminal

```powershell
cd "C:\Users\hp\my projects\food-delivery-app\backend"
.\ngrok.exe http 3000
```

If `ngrok` is on your PATH:

```powershell
ngrok http 3000
```

Use the **same port** as the server (usually `3000`).

### 4. Copy your current HTTPS URL

**Free ngrok URLs change every time you restart ngrok.** You must update config when the hostname changes.

**Option A — ngrok web UI (easiest)**  
Open [http://127.0.0.1:4040](http://127.0.0.1:4040) and copy the **Forwarding** address that starts with `https://`.

**Option B — PowerShell**

```powershell
(Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels").tunnels | Where-Object { $_.proto -eq "https" } | ForEach-Object { $_.public_url }
```

Example output: `https://something-random.ngrok-free.dev`

### 5. Put the URL in `backend/.env`

Set **`MPESA_CALLBACK_URL`** to either:

- **Base only:** `https://YOUR-SUBDOMAIN.ngrok-free.dev`  
- **Full callback:** `https://YOUR-SUBDOMAIN.ngrok-free.dev/api/payment/mpesa/callback`

The app will **append** `/api/payment/mpesa/callback` automatically if you only paste the base URL.

Save the file, then **restart** `node server.js` (step 2).

### 6. Register the same URL in Daraja (if your app requires it)

In the [Safaricom Daraja](https://developer.safaricom.co.ke/) portal, if there is **callback / URL management**, register the **exact** HTTPS callback, for example:

`https://YOUR-SUBDOMAIN.ngrok-free.dev/api/payment/mpesa/callback`

Safaricom sends STK results with **HTTP POST** to that path. Opening the link in a browser uses **GET** and only confirms the route exists.

### 7. Open the app

- **On this PC:** [http://localhost:3000](http://localhost:3000)
- **On your phone:** use the **https** ngrok URL, e.g. `https://YOUR-SUBDOMAIN.ngrok-free.dev`  
  (Your phone cannot use `localhost` to reach your PC.)

Free ngrok may show a **warning / “Visit Site”** page once in the browser; continue through it. The frontend sends headers so **API** calls are less likely to get HTML instead of JSON.

---

## Quick checks

| Check | URL or action |
|--------|----------------|
| API + DB | [http://localhost:3000/api/test-db](http://localhost:3000/api/test-db) |
| M-Pesa env loaded | [http://localhost:3000/api/payment/mpesa/env-check](http://localhost:3000/api/payment/mpesa/env-check) |
| Tunnel traffic | [http://127.0.0.1:4040](http://127.0.0.1:4040) |

---

## M-Pesa reminders (sandbox)

- **`MPESA_CONSUMER_KEY`** and **`MPESA_CONSUMER_SECRET`** must both come from your Daraja app; the **secret is not the same as the key**.
- **`MPESA_PASSKEY`** for sandbox test paybill **174379** is documented in `backend/.env.example`.
- For **UI-only** testing without Daraja, you can set **`MPESA_USE_SIMULATION=true`** in `backend/.env` (no real STK).

---

## If Windows “steals” your env vars

The server loads `backend/.env` with **`override: true`** so values in the file win over empty or duplicate variables sometimes set in Windows. If something still looks wrong, restart the terminal and the server after editing `backend/.env`.

---

## Files worth knowing

| File | Role |
|------|------|
| `backend/.env` | Database, `PORT`, all `MPESA_*` vars |
| `backend/.env.example` | Template and comments |
| `backend/server.js` | Express app, M-Pesa routes |
| `backend/services/mpesaDaraja.js` | Daraja OAuth + STK |
| `frontend/dashboard.html` | Checkout + STK button (uses `ngrok-skip-browser-warning` when on ngrok) |

---

## Short “cheat sheet”

1. MySQL on  
2. `cd backend` → `node server.js`  
3. Second terminal: `ngrok http 3000`  
4. Copy **https** URL from [127.0.0.1:4040](http://127.0.0.1:4040)  
5. Set `MPESA_CALLBACK_URL` in **`backend/.env`** → restart Node  
6. Optional: sync callback URL in Daraja  
7. Test: PC = `localhost:3000`, phone = `https://…ngrok-free.dev`
