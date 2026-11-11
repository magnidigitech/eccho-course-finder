# Eccho Overseas — Personalised Course Shortlist & UK Guide PDF Generator

Client-side React + TypeScript application for **Eccho Overseas** (deployable as a static web app on **Vercel** or packaged as a **Manifest V3 Chrome Extension**) that converts an uploaded Excel course workbook into a branded A4 portrait PDF:

1. **Personalised Summary (`Your Personalised Course Shortlist`)**: Prepared for the student with course, university, and destination counts, fixed-frame university logos, and `"View course ->"` internal PDF links to each course page.
2. **Individual Course Pages (1 course per A4 page)**: University identity, overview, two-panel tuition & scholarship summary, academic entry requirements, English language requirements (`IELTS`, `PTE`, `TOEFL`, `Duolingo`), waiver criteria (`Class 12 CBSE/ICSE`, `UK qualification`, `Class 12 State Board`), toolkit quick links, and clickable university website footer.
3. **UK Application Process**: 6-step guide distinguishing university admissions from UK Student visa (UKVI) rules, with clickable official GOV.UK and UKCISA links.
4. **Required Documents Checklist**: Interactive AcroForm PDF checkboxes across University application, CAS preparation, UK Student visa, and Before travel.

All Excel parsing, validation, PDF generation, checklist state, and live PDF preview rendering run strictly in memory—with zero backend calls, zero file uploads, and zero web `localStorage`, `sessionStorage`, `IndexedDB`, or service-worker data caching. Inside Chrome extension tabs only, `chrome.storage.session` keeps your active tab working state intact during preview navigation and clears automatically on **Reset** or when the extension tab closes.

## Key Features

- **Student Personalisation & Clean White / Charcoal / Forest-Green (`#3d8a3a`) Design**
  - Required **Student Name** field personalises headers (`Prepared for [Student Name]`), the summary, toolkit pages, and the sanitised download filename (`Eccho_Overseas_[Student_Name]_Course_Shortlist.pdf`).
  - Uses the bundled **Eccho Overseas** PNG logo (`src/assets/eccho-logo.png`), Lucide outline icons, and bundled Inter fonts.
- **Authoritative Excel Parsing (`.xlsx`)**
  - Reads **Course Data** automatically when present and never imports **Comparison** as additional course rows.
  - Excludes removed fields (`University Ranking`, `ELLT`, `ESOL`, `Kaplan Test of English`, `Language Certificate Academic SELT`, `Skills For English`).
  - Preserves source order, duplicates, zero (`0`) waiver values, decimals, mixed text/numeric scores, and full descriptions.
- **Automatic Online University Logo Discovery (Chrome Extension)**
  - Uses each university's Website URL and University name inside the extension background worker via narrowly scoped, user-approved `optional_host_permissions` (never requesting permanent access to all sites and never transmitting student or workbook data).
  - Extracts official candidates from `CollegeOrUniversity` / `Organization` JSON-LD schemas, `<header>` / `<nav>` images, inline SVGs, and header CSS logo backgrounds; rejects favicons, social banners, spacers, and accreditation badges.
  - Validates magic bytes and dimensions, sanitizes and rasterizes untrusted SVG without DOM injection, detects white-on-transparent logos to apply a dark charcoal frame automatically, directly selects the highest-ranked valid candidate (`Found`), and falls back cleanly to initials (`Unavailable`) + manual upload if blocked or permission is denied.
  - Embeds resolved PNG/JPEG bytes directly inside the PDF for completely offline viewing.
- **Clickable PDF Navigation & Interactive Checkboxes**
  - Summary rows jump directly to each course page via internal PDF `/GoTo` annotations; course, guide, and checklist pages link cleanly back to the summary and each other.
  - Strict single-page A4 course layout fitting (`>= 9 pt` body text) blocks export with a clear error if any course overflows one page.

## Local Development & Verification

```bash
npm install
npm run dev
```

Run verification suite:

```bash
npm run typecheck
npm test
npm run build
npm run build:extension
```

## Deploying to Vercel

1. Import this repository in Vercel.
2. Keep the default Vite settings (`npm run build`, output directory `dist`).
3. Deploy — no environment variables or backend services are needed (`vercel.json` included).

## Loading as a Chrome Extension (Manifest V3)

1. Build the local extension bundle (all scripts, fonts, workers, and assets bundled locally with no remote CDN code):

   ```bash
   npm run build:extension
   ```

2. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the generated `dist-extension` folder.
4. Click the **Eccho Overseas Course Shortlist** toolbar icon to launch the converter in a full browser tab.
