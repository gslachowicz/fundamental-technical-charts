# Ticker&Tape API

Cloudflare Worker `tickerandtape-api`, served at https://api.tickerandtape.com, with the D1 database `tickerandtape` bound as `DB`.

- `worker.js`: the deployed code (Cloudflare dashboard > Workers & Pages > tickerandtape-api > Edit code).
- `schema.sql`: the tables (users, sessions, user_data), already created in D1.

Endpoints: POST /auth/signup, /auth/login, /auth/logout, /auth/password; GET /me; GET /data; PUT /data/{watchlist|cfg|marks:SYMBOL}; public GET /tickers (every starred ticker, read by the nightly data build).

## Newsletter (the weekly)

- Table `subscribers` (see `schema.sql`): run it once in D1 > tickerandtape > Console.
- Secrets (Worker > Settings > Variables and secrets): `RESEND_API_KEY` (resend.com, with tickerandtape.com verified as a sending domain) and `ADMIN_KEY` (any long random string).
- Cron Trigger (Worker > Settings > Triggers): `0 2 * * 6` (Saturday 02:00 UTC = Friday 11 pm in Buenos Aires, once the Friday data build has finished).
- Endpoints: POST /subscribe {email} (sends a confirmation email), GET /confirm?t=, GET|POST /unsubscribe?t=,
  GET /newsletter/preview?key=ADMIN_KEY (HTML of this week's email), /newsletter/test?key= (sends it to contacto@), /newsletter/stats?key=.
- The site shows the sign-up forms when `NEWSLETTER_ON = true` in `site/app.js`.
