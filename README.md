# Eccho Overseas — Personalized Course Shortlist & UK Guide PDF Generator

Client-side React + TypeScript web application for **Eccho Overseas** that converts an uploaded Excel course workbook into a branded, personalized A4 portrait PDF containing:

1. **Course Shortlist**: exactly one course per page.
2. **UK Application Process**: numbered step-by-step guide distinguishing university admissions from UK Student visa (UKVI) requirements, with verified clickable official GOV.UK and UKCISA links.
3. **Required Documents Checklist**: interactive AcroForm PDF checkboxes organized across University application, CAS preparation, UK Student visa, and Before travel.

All Excel parsing, validation, PDF generation, checklist state, and live PDF preview rendering run strictly in browser memory—with zero backend calls, zero file uploads, and zero browser persistence (`localStorage`, `sessionStorage`, `IndexedDB`, or service-worker data caching).

## Key Features

- **Student Personalisation & Green Brand Theme (`#3d8a3a`)**
  - Required **Student Name** field above the Excel upload personalizes every PDF header (`Prepared for [Student Name]`), the UK guide and checklist pages, and the sanitized download filename (`Eccho_Overseas_[Student_Name]_Course_Shortlist.pdf`).
  - Uses the bundled **Eccho Overseas** green logo (`src/assets/eccho-logo.png`) on both the portal and PDF (with optional in-memory override) and the `#3d8a3a` green theme throughout.
- **Authoritative Excel Parsing (`.xlsx`)**
  - Automatically detects and reads **Course Data** when present and never imports **Comparison** as course rows.
  - Allows worksheet selection for other workbooks and validates required columns (**Program Name** and **University**) after trimming whitespace and normalizing case.
  - Preserves original course order, duplicates, zero (`0`), decimals (`6.5`), mixed text/numeric scores (`89 or 4`, `B2`), and full scholarship/requirement text; renders blanks, em dashes (`—`), and `N/A` as **Not specified**.
  - Automatically confirms **GBP** when explicitly specified in the workbook (`COST & FUNDING (GBP)`) and requires currency selection before export when unspecified.
- **Clickable PDF Navigation & Interactive Checkboxes**
  - Course pages link directly via internal PDF `GoTo` annotations to **UK Application Process** and **Required Documents Checklist**; guide and checklist pages link back via **Back to Course Shortlist**.
  - Pre-export checklist selections carry into unique, accessible AcroForm PDF checkbox fields (`/TU` labels) that can be ticked, unticked, and saved in compatible PDF readers.
  - Strict single-page A4 fitting (`>= 9 pt` body text) blocks export with a clear course error if any course overflows one page.
- **Live PDF Preview & Reset**
  - Previews render directly from the generated PDF bytes via `pdfjs-dist` with clickable external and internal page links.
  - **Reset** clears Student Name, uploaded Excel file, parsed data, checklist selections, logo overrides, object URLs, and preview.

## Brand & Guide Configuration

- Brand name, `#3d8a3a` color tokens, bundled logo path, and optional contact details: `src/config/brand.ts`
- Bundled UK Application Process steps, official guidance links, checked date, and Required Documents Checklist items: `src/config/ukGuide.ts`

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

1. Push to GitHub and import the repository in Vercel.
2. Use the default Vite settings (`npm run build`, output directory `dist`).
3. Deploy—no environment variables or backend services are needed.
