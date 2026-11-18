# Quick Google Review

A mobile-first, single-business review landing page with a protected owner dashboard. Customers can optionally select a star rating and type their own private on-page notes, then open the exact same configured Google review URL. The website does not generate review wording, pass customer text to Google, store ratings/comments, gate the Google link, or claim a review was submitted.

## Requirements

- Node.js 20 or newer
- npm
- A public HTTPS domain for production

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `SESSION_SECRET` to a random value of at least 32 characters.
3. Set `ADMIN_PASSWORD` to a strong unique password (at least 12 characters).
4. Optionally set `BASE_URL=http://localhost:3000`.
5. Install and start:

   ```bash
   npm install
   npm start
   ```
6. Open `http://localhost:3000/admin.html` and sign in using `ADMIN_PASSWORD`.
7. Enter the business name and official Google review URL, then save. Upload a logo and adjust brand/button colors if desired.
8. Use the live preview to check the customer page. Download the QR PNG and print it for your counter, table, bill, or receipt.

## Find the official Google review link

In the business's Google Business Profile, use the option to request/share reviews and copy the review link. Paste that HTTPS Google link into the admin field. The application checks that the URL uses a recognized Google domain before saving. It does not verify that the link belongs to the intended business, so the owner should test it in a private browser before printing the QR code.

## Deploy

Deploy this Node application to a Node-compatible host (for example, a VPS or managed Node host). Configure `SESSION_SECRET`, `ADMIN_PASSWORD`, and `BASE_URL` in the host's secret/environment settings. `BASE_URL` must be the final public HTTPS origin, e.g. `https://reviews.example.com`. Enable HTTPS and ensure the host forwards the original protocol correctly. The app uses secure session cookies in `NODE_ENV=production` and trusts one reverse proxy by default.

Persist the `data/` directory and `public/uploads/` directory across restarts and deployments (or replace them with managed persistent storage). The default Express memory session store is suitable only for a small single-instance demo; use a persistent shared session store such as Redis for production or multiple instances. Back up the config and logo storage.

## Routes

- `/` — customer landing page
- `/admin.html` — owner sign-in and dashboard
- `/qr.png` — public QR image that encodes the landing page URL
- `/api/public-config` — safe public business branding and readiness state

## Privacy and fairness behavior

- Star rating is optional and only changes the selected-star display.
- Text entered in the optional textarea stays in the browser and is never sent to the server.
- The rating and text never affect the Google URL, button visibility, or button label.
- The Google button is the same for all customers and opens the configured Google destination in a new tab. A fallback link is shown after tapping.
- The customer must write and submit any Google review themselves.
- No customer name, email, phone number, account information, rating, or comment is collected or persisted.

## Production notes

This project uses a simple environment-configured admin password and an in-process session store. Before operating at scale, configure a persistent session store, backups, monitoring, and a managed file/object store. Restrict admin access further if required by your business. Never commit `.env`, `data/config.json`, or uploaded logos to source control.
