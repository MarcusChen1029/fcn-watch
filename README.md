# FCN 監控

A free tool for tracking FCN (Fixed Coupon Note) structured notes you already hold. Enter a note's
terms once. Each visit then uses the latest closes to show how far each underlying is from KO and KI,
the coupons received so far, the next observation date, and the share delivery if it settles in stock.

- Static site. Your notes stay in your browser (localStorage).
- `engine.js` holds the KO/KI logic. To test it: `node --test tests/engine.test.mjs`
- `scripts/fetch_prices.py` writes daily closes to `data/px/` and runs twice each weekday via GitHub Actions.
- The supported tickers are listed in `data/universe.json`.

The tool does math on public closing prices only. It is not investment advice.
The issuer's notices decide actual KO/KI events, coupons and settlement.
