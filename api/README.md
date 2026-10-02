# Ticker&Tape API

Cloudflare Worker `tickerandtape-api`, served at https://api.tickerandtape.com, with the D1 database `tickerandtape` bound as `DB`.

- `worker.js`: the deployed code (Cloudflare dashboard > Workers & Pages > tickerandtape-api > Edit code).
- `schema.sql`: the tables (users, sessions, user_data), already created in D1.

Endpoints: POST /auth/signup, /auth/login, /auth/logout, /auth/password; GET /me; GET /data; PUT /data/{watchlist|cfg|marks:SYMBOL}; public GET /tickers (every starred ticker, read by the nightly data build).
