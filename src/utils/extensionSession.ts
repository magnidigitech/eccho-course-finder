import type {
  ChecklistSelections,
  CurrencyCode,
  InMemoryLogo,
  UniversityLogoMap,
  WorkbookSession,
} from '../types/course';

const EXTENSION_SESSION_KEY = 'eccho_converter_session_v1';

interface ChromeStorageSessionLike {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

interface ChromeLike {
  runtime?: {
    id?: string;
    sendMessage?: (msg: unknown) => Promise<unknown> | void;
  };
  storage?: {
    session?: ChromeStorageSessionLike;
  };
}

function getChromeExtensionApis(): ChromeLike | null {
  const g = globalThis as { chrome?: ChromeLike };
  if (g.chrome?.runtime?.id && g.chrome.storage?.session) {
    return g.chrome;
  }
  return null;
}

export function isChromeExtensionTab(): boolean {
  return getChromeExtensionApis() !== null;
}

interface SerializedLogo {
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg';
  base64: string;
}

export interface PersistedExtensionSession {
  studentName: string;
  workbookSession: WorkbookSession | null;
  selectedSheet: string;
  selectedCurrency: CurrencyCode | '';
  activePageNumber: number;
  checklistSelections: ChecklistSelections;
  customBrandLogo: SerializedLogo | null;
  customUniversityLogos: Record<
    string,
    { universityName: string; source: 'uploaded' | 'fetched'; logo: SerializedLogo }
  >;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function serializeInMemoryLogo(logo: InMemoryLogo | null): SerializedLogo | null {
  if (!logo) return null;
  return {
    fileName: logo.fileName,
    mimeType: logo.mimeType,
    base64: uint8ToBase64(logo.bytes),
  };
}

export function deserializeInMemoryLogo(raw: SerializedLogo | null): InMemoryLogo | null {
  if (!raw) return null;
  const bytes = base64ToUint8(raw.base64);
  const previewUrl = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: raw.mimeType }),
  );
  return {
    fileName: raw.fileName,
    mimeType: raw.mimeType,
    bytes,
    previewUrl,
  };
}

export async function registerExtensionConverterTab(): Promise<void> {
  const chromeApi = getChromeExtensionApis();
  if (!chromeApi?.runtime?.sendMessage) return;
  try {
    await chromeApi.runtime.sendMessage({ type: 'REGISTER_CONVERTER_TAB' });
  } catch {
    // Ignore if SW is waking
  }
}

export async function saveExtensionSessionState(params: {
  studentName: string;
  workbookSession: WorkbookSession | null;
  selectedSheet: string;
  selectedCurrency: CurrencyCode | '';
  activePageNumber: number;
  checklistSelections: ChecklistSelections;
  customBrandLogo: InMemoryLogo | null;
  universityLogos: UniversityLogoMap;
}): Promise<void> {
  const chromeApi = getChromeExtensionApis();
  if (!chromeApi?.storage?.session) return;

  const customUniversityLogos: PersistedExtensionSession['customUniversityLogos'] = {};
  for (const [key, entry] of Object.entries(params.universityLogos)) {
    if ((entry.source === 'uploaded' || entry.source === 'fetched') && entry.logo) {
      const serialized = serializeInMemoryLogo(entry.logo);
      if (serialized) {
        customUniversityLogos[key] = {
          universityName: entry.universityName,
          source: entry.source,
          logo: serialized,
        };
      }
    }
  }

  const payload: PersistedExtensionSession = {
    studentName: params.studentName,
    workbookSession: params.workbookSession,
    selectedSheet: params.selectedSheet,
    selectedCurrency: params.selectedCurrency,
    activePageNumber: params.activePageNumber,
    checklistSelections: params.checklistSelections,
    customBrandLogo: serializeInMemoryLogo(params.customBrandLogo),
    customUniversityLogos,
  };

  try {
    await chromeApi.storage.session.set({ [EXTENSION_SESSION_KEY]: payload });
  } catch {
    // Ignore storage quota errors safely
  }
}

export async function loadExtensionSessionState(): Promise<PersistedExtensionSession | null> {
  const chromeApi = getChromeExtensionApis();
  if (!chromeApi?.storage?.session) return null;
  try {
    const res = await chromeApi.storage.session.get(EXTENSION_SESSION_KEY);
    const val = res[EXTENSION_SESSION_KEY];
    return val && typeof val === 'object' ? (val as PersistedExtensionSession) : null;
  } catch {
    return null;
  }
}

export async function clearExtensionSessionState(): Promise<void> {
  const chromeApi = getChromeExtensionApis();
  if (!chromeApi) return;
  try {
    await chromeApi.storage?.session?.remove(EXTENSION_SESSION_KEY);
    await chromeApi.runtime?.sendMessage?.({ type: 'CLEAR_EXTENSION_SESSION' });
  } catch {
    // Ignore
  }
}

