import type {
  PendingExternalImageHost,
} from '../types/course';
import {
  detectBotBlockOrFailure,
  extractLogoCandidatesFromCss,
  extractLogoCandidatesFromHtml,
  normalizeUniversityWebsiteUrl,
  rankAndFilterCandidates,
  type RawLogoCandidate,
} from '../utils/logoDiscovery';
import { uint8BytesToBase64 } from '../utils/base64';

interface ChromeApiLike {
  storage?: {
    session?: {
      get: (keys: unknown) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
  };
  action?: {
    onClicked?: { addListener: (cb: () => void | Promise<void>) => void };
  };
  tabs?: {
    get: (tabId: number) => Promise<{ id?: number; windowId?: number }>;
    create: (opts: { url: string }) => Promise<{ id?: number }>;
    update: (tabId: number, opts: { active: boolean }) => Promise<unknown>;
    onRemoved?: { addListener: (cb: (tabId: number) => void | Promise<void>) => void };
  };
  windows?: {
    update: (windowId: number, opts: { focused: boolean }) => Promise<unknown>;
  };
  permissions?: {
    contains: (perms: { origins: string[] }) => Promise<boolean>;
  };
  runtime?: {
    getURL: (path: string) => string;
    onMessage?: {
      addListener: (
        cb: (
          message: Record<string, unknown>,
          sender: { tab?: { id?: number } },
          sendResponse: (resp?: unknown) => void,
        ) => boolean | void,
      ) => void;
    };
  };
}

declare const chrome: ChromeApiLike;

const CONVERTER_TABS_KEY = 'eccho_converter_tab_ids';
const SESSION_DATA_KEY = 'eccho_converter_session_v1';
const HTML_MAX_BYTES = 1_572_864; // 1.5 MB cap for HTML/CSS
const IMAGE_MAX_BYTES = 3_145_728; // 3 MB cap for image files
const REQUEST_TIMEOUT_MS = 10_000;

interface BackgroundCandidateResult {
  id: string;
  sourceUrl: string;
  sourceKind: RawLogoCandidate['sourceKind'];
  sourceLabel: string;
  score: number;
  rawSvg?: string;
  base64Bytes?: string;
  contentType?: string;
  likelyWhiteVariant?: boolean;
}

export interface DiscoverUniversityResponse {
  ok: boolean;
  status: 'permission_required' | 'candidates' | 'unavailable';
  requiredOrigins?: string[];
  finalWebsiteUrl?: string;
  candidates?: BackgroundCandidateResult[];
  pendingExternalHosts?: PendingExternalImageHost[];
  reason?: string;
}

async function getTrackedTabIds(): Promise<number[]> {
  const result = await chrome.storage?.session?.get({
    [CONVERTER_TABS_KEY]: [],
  });
  const list = result?.[CONVERTER_TABS_KEY];
  return Array.isArray(list) ? (list as number[]) : [];
}

async function setTrackedTabIds(tabIds: number[]): Promise<void> {
  await chrome.storage?.session?.set({ [CONVERTER_TABS_KEY]: tabIds });
}

async function readStreamWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const lenHeader = response.headers.get('content-length');
  if (lenHeader) {
    const declared = Number(lenHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Response exceeds size limit (${maxBytes} bytes).`);
    }
  }

  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`Response exceeds size limit (${maxBytes} bytes).`);
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds size limit (${maxBytes} bytes).`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchBoundedBytes(
  url: string,
  maxBytes: number,
  accept: string,
): Promise<{
  status: number;
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: accept },
    });
    const bytes = await readStreamWithLimit(res, maxBytes);
    return {
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
      bytes,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function hasOriginPermission(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const granted = await chrome.permissions?.contains({
      origins: [`${parsed.origin}/*`],
    });
    return Boolean(granted);
  } catch {
    return false;
  }
}

async function handleDiscoverUniversityLogo(payload: {
  universityName: string;
  websiteHref: string | null;
}): Promise<DiscoverUniversityResponse> {
  const target = normalizeUniversityWebsiteUrl(payload.websiteHref);
  if (!target) {
    return {
      ok: false,
      status: 'unavailable',
      reason: 'No valid university Website URL was supplied.',
    };
  }

  const permittedSite = await hasOriginPermission(target.normalizedUrl);
  if (!permittedSite) {
    return {
      ok: false,
      status: 'permission_required',
      requiredOrigins: target.requiredOriginPatterns,
      reason: `Permission required for ${target.hostname}.`,
    };
  }

  let htmlFetch: Awaited<ReturnType<typeof fetchBoundedBytes>>;
  try {
    htmlFetch = await fetchBoundedBytes(
      target.normalizedUrl,
      HTML_MAX_BYTES,
      'text/html,application/xhtml+xml',
    );
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? `Timed out waiting for ${target.hostname}.`
        : `Unable to connect cleanly to ${target.hostname}. Check network or permission after redirect.`;
    return { ok: false, status: 'unavailable', reason: msg };
  }

  const htmlText = new TextDecoder('utf-8', { fatal: false }).decode(
    htmlFetch.bytes,
  );
  const blockMsg = detectBotBlockOrFailure(htmlFetch.status, htmlText);
  if (blockMsg) {
    return {
      ok: false,
      status: 'unavailable',
      finalWebsiteUrl: htmlFetch.finalUrl,
      reason: blockMsg,
    };
  }

  const extracted = extractLogoCandidatesFromHtml(
    htmlText,
    htmlFetch.finalUrl,
    payload.universityName,
  );

  let allCandidates = [...extracted.candidates];

  // Check up to 2 primary same-origin stylesheets when header relies on CSS background logo
  for (const cssUrl of extracted.stylesheetUrlsToCheck.slice(0, 2)) {
    const permittedCss = await hasOriginPermission(cssUrl);
    if (!permittedCss) continue;
    try {
      const cssFetch = await fetchBoundedBytes(
        cssUrl,
        HTML_MAX_BYTES,
        'text/css,*/*;q=0.1',
      );
      if (cssFetch.status >= 200 && cssFetch.status < 300) {
        const cssText = new TextDecoder('utf-8', { fatal: false }).decode(
          cssFetch.bytes,
        );
        const cssCandidates = extractLogoCandidatesFromCss(
          cssText,
          cssFetch.finalUrl,
        );
        allCandidates = [...allCandidates, ...cssCandidates];
      }
    } catch {
      // Non-fatal stylesheet error; keep HTML candidates
    }
  }

  const ranked = rankAndFilterCandidates(allCandidates, payload.universityName);
  if (ranked.length === 0) {
    return {
      ok: false,
      status: 'unavailable',
      finalWebsiteUrl: htmlFetch.finalUrl,
      reason: `No valid official logo candidate was identified on ${target.hostname}.`,
    };
  }

  const fetchedCandidates: BackgroundCandidateResult[] = [];
  const pendingExternalHosts: PendingExternalImageHost[] = [];
  const seenExternalOrigins = new Set<string>();

  for (let i = 0; i < Math.min(4, ranked.length); i += 1) {
    const item = ranked[i];
    const cid = `cand_${i + 1}`;

    if (item.rawSvg) {
      fetchedCandidates.push({
        id: cid,
        sourceUrl: item.url,
        sourceKind: item.sourceKind,
        sourceLabel: item.sourceLabel,
        score: item.score,
        rawSvg: item.rawSvg,
        likelyWhiteVariant: item.likelyWhiteVariant,
      });
      continue;
    }

    const canFetchImg = await hasOriginPermission(item.url);
    if (!canFetchImg) {
      try {
        const parsed = new URL(item.url);
        if (!seenExternalOrigins.has(parsed.origin)) {
          seenExternalOrigins.add(parsed.origin);
          pendingExternalHosts.push({
            origin: parsed.origin,
            originPattern: `${parsed.origin}/*`,
            candidateUrl: item.url,
            sourceKind: item.sourceKind,
            sourceLabel: item.sourceLabel,
            score: item.score,
          });
        }
      } catch {
        // Skip invalid URL
      }
      continue;
    }

    try {
      const imgFetch = await fetchBoundedBytes(
        item.url,
        IMAGE_MAX_BYTES,
        'image/png,image/jpeg,image/webp,image/svg+xml,image/*;q=0.8',
      );
      if (imgFetch.status >= 200 && imgFetch.status < 300) {
        fetchedCandidates.push({
          id: cid,
          sourceUrl: imgFetch.finalUrl,
          sourceKind: item.sourceKind,
          sourceLabel: item.sourceLabel,
          score: item.score,
          base64Bytes: uint8BytesToBase64(imgFetch.bytes),
          contentType: imgFetch.contentType,
          likelyWhiteVariant: item.likelyWhiteVariant,
        });
      }
    } catch {
      // Skip unfetchable image cleanly
    }
  }

  return {
    ok: true,
    status: 'candidates',
    finalWebsiteUrl: htmlFetch.finalUrl,
    candidates: fetchedCandidates,
    pendingExternalHosts,
  };
}

async function handleFetchCandidateImage(payload: {
  candidateUrl: string;
}): Promise<{
  ok: boolean;
  permissionRequiredOrigin?: string;
  base64Bytes?: string;
  finalUrl?: string;
  contentType?: string;
  reason?: string;
}> {
  const permitted = await hasOriginPermission(payload.candidateUrl);
  if (!permitted) {
    try {
      const parsed = new URL(payload.candidateUrl);
      return { ok: false, permissionRequiredOrigin: `${parsed.origin}/*` };
    } catch {
      return { ok: false, reason: 'Invalid candidate URL.' };
    }
  }

  try {
    const imgFetch = await fetchBoundedBytes(
      payload.candidateUrl,
      IMAGE_MAX_BYTES,
      'image/png,image/jpeg,image/webp,image/svg+xml,image/*;q=0.8',
    );
    if (imgFetch.status < 200 || imgFetch.status >= 300) {
      return {
        ok: false,
        reason: `Image host returned HTTP ${imgFetch.status}.`,
      };
    }
    return {
      ok: true,
      finalUrl: imgFetch.finalUrl,
      contentType: imgFetch.contentType,
      base64Bytes: uint8BytesToBase64(imgFetch.bytes),
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Image download failed.',
    };
  }
}

// ============================================================================
// Top-level synchronous Chrome MV3 Service Worker listeners
// ============================================================================

chrome.action?.onClicked?.addListener(async () => {
  const converterUrl = chrome.runtime!.getURL('index.html');
  const trackedIds = await getTrackedTabIds();

  for (const tabId of trackedIds) {
    try {
      const existing = await chrome.tabs?.get(tabId);
      if (existing?.id !== undefined) {
        await chrome.tabs?.update(existing.id, { active: true });
        if (existing.windowId !== undefined) {
          await chrome.windows?.update(existing.windowId, { focused: true });
        }
        return;
      }
    } catch {
      // Closed tab
    }
  }

  const created = await chrome.tabs?.create({ url: converterUrl });
  if (created?.id !== undefined) {
    await setTrackedTabIds([created.id]);
  }
});

chrome.tabs?.onRemoved?.addListener(async (closedTabId) => {
  const trackedIds = await getTrackedTabIds();
  if (!trackedIds.includes(closedTabId)) return;

  const remaining = trackedIds.filter((id) => id !== closedTabId);
  if (remaining.length === 0) {
    await chrome.storage?.session?.remove([CONVERTER_TABS_KEY, SESSION_DATA_KEY]);
  } else {
    await setTrackedTabIds(remaining);
  }
});

chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type === 'REGISTER_CONVERTER_TAB') {
    (async () => {
      const senderTabId = sender.tab?.id;
      if (senderTabId !== undefined) {
        const current = await getTrackedTabIds();
        if (!current.includes(senderTabId)) {
          await setTrackedTabIds([...current, senderTabId]);
        }
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'CLEAR_EXTENSION_SESSION') {
    (async () => {
      await chrome.storage?.session?.remove(SESSION_DATA_KEY);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'DISCOVER_UNIVERSITY_LOGO') {
    handleDiscoverUniversityLogo({
      universityName: String(message.universityName ?? ''),
      websiteHref:
        typeof message.websiteHref === 'string' ? message.websiteHref : null,
    })
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          status: 'unavailable',
          reason: err instanceof Error ? err.message : 'Discovery failed.',
        }),
      );
    return true;
  }

  if (message?.type === 'FETCH_CANDIDATE_IMAGE') {
    handleFetchCandidateImage({
      candidateUrl: String(message.candidateUrl ?? ''),
    })
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          reason: err instanceof Error ? err.message : 'Fetch failed.',
        }),
      );
    return true;
  }

  return false;
});
