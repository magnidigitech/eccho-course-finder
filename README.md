# Eccho Overseas — Course Shortlist PDF Generator

Client-side React + TypeScript web application for **Eccho Overseas** that converts an uploaded Excel course workbook into a branded, print-ready A4 portrait PDF (**exactly one course per page**).

All Excel parsing, validation, PDF generation, and live PDF preview rendering happen strictly inside the browser in memory—with zero backend services, zero external API calls, and zero browser persistence (`localStorage`, `sessionStorage`, `IndexedDB`, or service-worker data caching).

## Key Features

- **Authoritative Excel Parsing (`.xlsx`)**
  - Automatically detects and reads the **Course Data** worksheet when present and never imports the **Comparison** sheet as extra courses.
  - Allows worksheet selection for other workbooks and validates required columns (**Program Name** and **University**) after trimming whitespace and normalizing case.
  - Ignores completely empty rows, preserves original course order, and does not deduplicate courses.
- **Strict Data Integrity**
  - Preserves complete entry requirements (formatting semicolon-separated conditions onto separate lines) and full scholarship descriptions without calculating net tuition or assuming guaranteed awards.
  - Preserves zero (`0`), decimals (`6.5`), and mixed text/numeric scores (`89 or 4`, `B2`).
  - Displays blanks, em dashes (`—`), and `N/A` as **Not specified**.
  - Keeps ambiguous ranking values exactly as supplied, labeled **As provided**.
  - Automatically confirms **GBP** when explicitly specified in the workbook (`COST & FUNDING (GBP)`) and requires explicit currency selection before export when a workbook has no explicit currency.
- **Branded A4 Portrait PDF & Strict Page Fitting**
  - White background, navy typography, restrained orange accents, embedded Inter TTF fonts (full `£`, `%`, and punctuation support), selectable text, and clickable university website links.
  - Uses measured text wrapping and multi-tier layout sizing (`>= 9 pt` body text) to guarantee zero clipping, overlap, truncation, or spillover; blocks export with a clear course-specific error if a course cannot fit on a single A4 page.
  - Optional in-memory logo upload (defaults to the `ECCHO OVERSEAS` text wordmark).
- **Live PDF Preview & Reset**
  - Renders previews directly from the generated PDF bytes via `pdfjs-dist` with course list navigation and Previous/Next controls.
  - **Reset** clears the active file, parsed data, logo, object URLs, and preview.

## Brand Configuration

Update brand name, colors, optional logo path, and optional contact details in one file:

- `src/config/brand.ts`

Empty contact fields are omitted automatically.

## Local Development

```bash
npm install
npm run dev
```

Run checks and tests:

```bash
npm run typecheck
npm test
npm run build
```

## Deploying to Vercel

This is a static Vite SPA (`vercel.json` included):

1. Push this repository to GitHub/GitLab/Bitbucket (or run `npx vercel` directly from the project folder).
2. Import the project in Vercel with default Vite settings:
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Deploy—no environment variables or serverless functions are required.

