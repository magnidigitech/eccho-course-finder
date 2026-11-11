import { describe, expect, it } from 'vitest';
import type { DiscoveredLogoCandidate } from '../../types/course';
import {
  detectBotBlockOrFailure,
  extractLogoCandidatesFromCss,
  extractLogoCandidatesFromHtml,
  normalizeUniversityWebsiteUrl,
} from '../logoDiscovery';
import {
  resolveCandidateOutcome,
  sniffImageBytesFormat,
} from '../logoProcessor';

describe('University website URL normalization & bot-block handling', () => {
  it('normalizes http:// URLs to https:// with apex + www origin patterns', () => {
    const norm = normalizeUniversityWebsiteUrl('http://www.sussex.ac.uk');
    expect(norm).not.toBeNull();
    expect(norm?.normalizedUrl).toBe('https://www.sussex.ac.uk/');
    expect(norm?.originPattern).toBe('https://www.sussex.ac.uk/*');
    expect(norm?.requiredOriginPatterns).toContain('https://sussex.ac.uk/*');

    expect(normalizeUniversityWebsiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUniversityWebsiteUrl('')).toBeNull();
  });

  it('detects HTTP 403 / 429 / Cloudflare bot challenges without attempting bypass', () => {
    expect(detectBotBlockOrFailure(403, 'Forbidden')).toContain('HTTP 403');
    expect(detectBotBlockOrFailure(429, 'Too many')).toContain('HTTP 429');
    expect(
      detectBotBlockOrFailure(
        200,
        '<html><title>Just a moment...</title><script>window._cf_chl_opt={}</script></html>',
      ),
    ).toContain('bot challenge');
    expect(detectBotBlockOrFailure(200, '<html><body>Welcome</body></html>')).toBeNull();
  });
});

describe('HTML, JSON-LD, and CSS logo candidate discovery & noise filtering', () => {
  it('resolves relative logo URLs against redirected finalUrl and ignores favicons and award badges', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <link rel="icon" sizes="144x144" href="/favicon.png" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <meta property="og:image" content="/assets/hero-banner.jpg" />
        </head>
        <body>
          <header>
            <a href="/">
              <img class="header-screen-logo" src="/getmedia/355/brookeslogo.svg" alt="Oxford Brookes University" />
              <img class="header-print-logo" src="/getmedia/999/logo-print.png" alt="Oxford Brookes University" />
            </a>
          </header>
          <footer>
            <img src="/sites/default/files/advancehe-race-equality-charter-silver-award-logo.jpg" alt="Race Equality Charter Silver Award" />
            <img src="/assets/images/logos/research-plus-wide.svg" alt="ResearchPlus" />
          </footer>
        </body>
      </html>
    `;

    const res = extractLogoCandidatesFromHtml(
      html,
      'https://www.brookes.ac.uk/en/',
      'Oxford Brookes University',
    );
    const urls = res.candidates.map((c) => c.url);

    expect(urls).toContain('https://www.brookes.ac.uk/getmedia/355/brookeslogo.svg');
    expect(urls).toContain('https://www.brookes.ac.uk/getmedia/999/logo-print.png');
    expect(urls.some((u) => u.includes('favicon'))).toBe(false);
    expect(urls.some((u) => u.includes('apple-touch-icon'))).toBe(false);
    expect(urls.some((u) => u.includes('hero-banner'))).toBe(false);
    expect(urls.some((u) => u.includes('advancehe'))).toBe(false);
    expect(urls.some((u) => u.includes('research-plus'))).toBe(false);
  });

  it('extracts JSON-LD CollegeOrUniversity/EducationalOrganization logos while dropping blank.gif spacers', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "EducationalOrganization",
              "name": "Northumbria University",
              "url": "https://www.northumbria.ac.uk",
              "logo": "https://northumbria-cdn.azureedge.net/images/northumbria-logo.png"
            }
          </script>
        </head>
        <body>
          <header>
            <img src="/common/images/blank.gif" alt="Northumbria University Logo" />
          </header>
        </body>
      </html>
    `;

    const res = extractLogoCandidatesFromHtml(
      html,
      'https://www.northumbria.ac.uk/',
      'Northumbria University Newcastle Campus',
    );
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].url).toBe(
      'https://northumbria-cdn.azureedge.net/images/northumbria-logo.png',
    );
    expect(res.candidates[0].sourceKind).toBe('jsonld');
  });

  it('inspects same-origin stylesheets when header renders CSS logo and decodes data-URI SVGs', () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="/assets/css/algae.css" />
        </head>
        <body>
          <header><div class="logo"><a href="/"><span>University of Sussex</span></a></div></header>
        </body>
      </html>
    `;
    const htmlRes = extractLogoCandidatesFromHtml(
      html,
      'https://www.sussex.ac.uk/',
      'University of Sussex',
    );
    expect(htmlRes.stylesheetUrlsToCheck).toEqual([
      'https://www.sussex.ac.uk/assets/css/algae.css',
    ]);

    const css = `
      .logo a {
        background-image: url(/assets/logos/logo.png);
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg viewBox='0 0 113 113' xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='%23003B49' width='100' height='100'/%3E%3C/svg%3E"), linear-gradient(#0000, #0000);
      }
    `;
    const cssCandidates = extractLogoCandidatesFromCss(
      css,
      'https://www.sussex.ac.uk/assets/css/algae.css',
    );
    expect(cssCandidates.some((c) => Boolean(c.rawSvg))).toBe(true);
    expect(
      cssCandidates.some(
        (c) => c.url === 'https://www.sussex.ac.uk/assets/logos/logo.png',
      ),
    ).toBe(true);
  });

  it('penalizes likely white variants relative to dark variants', () => {
    const html = `
      <html>
        <body>
          <header>
            <img src="/logos/uni_logo_white.svg" alt="Example University logo" />
            <img src="/logos/uni_logo_dark.svg" alt="Example University logo" />
          </header>
        </body>
      </html>
    `;
    const res = extractLogoCandidatesFromHtml(
      html,
      'https://www.example.ac.uk/',
      'Example University',
    );
    expect(res.candidates[0].url).toBe('https://www.example.ac.uk/logos/uni_logo_dark.svg');
    expect(res.candidates[1].likelyWhiteVariant).toBe(true);
  });
});

describe('Image magic-byte verification & candidate ambiguity resolution', () => {
  it('sniffs PNG, JPEG, WebP, and UTF-8 SVG while rejecting GIF and HTML error pages', () => {
    expect(
      sniffImageBytesFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    ).toBe('png');
    expect(
      sniffImageBytesFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe('jpeg');
    expect(
      sniffImageBytesFormat(new TextEncoder().encode('GIF89a......')),
    ).toBeNull();
    expect(
      sniffImageBytesFormat(new TextEncoder().encode('<!DOCTYPE html><html>404</html>')),
    ).toBeNull();
    expect(
      sniffImageBytesFormat(new TextEncoder().encode('<svg viewBox="0 0 100 40"></svg>')),
    ).toBe('svg');
  });

  it('directly auto-picks the best candidate using score, light/dark contrast, PNG over JPEG, and resolution', () => {
    const mkCandidate = (
      id: string,
      score: number,
      opts: {
        mimeType?: 'image/png' | 'image/jpeg';
        needsDarkBackdrop?: boolean;
        pixelWidth?: number;
        pixelHeight?: number;
      } = {},
    ): DiscoveredLogoCandidate => ({
      id,
      sourceUrl: `https://uni.ac.uk/${id}.${opts.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
      sourceKind: 'header_img',
      sourceLabel: 'Header image',
      score,
      logo: {
        fileName: `${id}.png`,
        mimeType: opts.mimeType ?? 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
        previewUrl: `blob:${id}`,
        needsDarkBackdrop: opts.needsDarkBackdrop ?? false,
        pixelWidth: opts.pixelWidth ?? 200,
        pixelHeight: opts.pixelHeight ?? 80,
      },
    });

    const pngVsJpgTie = resolveCandidateOutcome([
      mkCandidate('jpg_ver', 96, { mimeType: 'image/jpeg', pixelWidth: 580, pixelHeight: 182 }),
      mkCandidate('png_ver', 96, { mimeType: 'image/png', pixelWidth: 240, pixelHeight: 73 }),
    ]);
    expect(pngVsJpgTie.status).toBe('found');
    expect(pngVsJpgTie.selected?.id).toBe('png_ver');

    const contrastTie = resolveCandidateOutcome([
      mkCandidate('white_ver', 96, { needsDarkBackdrop: true }),
      mkCandidate('dark_ver', 96, { needsDarkBackdrop: false }),
    ]);
    expect(contrastTie.status).toBe('found');
    expect(contrastTie.selected?.id).toBe('dark_ver');

    const scoreWinner = resolveCandidateOutcome([
      mkCandidate('primary', 108),
      mkCandidate('fallback', 80),
    ]);
    expect(scoreWinner.status).toBe('found');
    expect(scoreWinner.selected?.id).toBe('primary');
  });
});

