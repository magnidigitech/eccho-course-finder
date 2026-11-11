import type {
  ChecklistSelections,
  CurrencyCode,
  InMemoryLogo,
  UniversityLogoMap,
  WorkbookSession,
} from '../types/course';
import { base64ToUint8Bytes, uint8BytesToBase64 } from './base64';

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
  needsDarkBackdrop?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
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
    {
      universityName: string;
      source: 'uploaded' | 'discovered';
      logoSourceUrl?: string | null;
      logo: SerializedLogo;
    }
  >;
}

export function serializeInMemoryLogo(logo: InMemoryLogo | null): SerializedLogo | null {
  if (!logo) return null;
  return {
    fileName: logo.fileName,
    mimeType: logo.mimeType,
    base64: uint8BytesToBase64(logo.bytes),
    needsDarkBackdrop: logo.needsDarkBackdrop,
    pixelWidth: logo.pixelWidth,
    pixelHeight: logo.pixelHeight,
  };
}

export function deserializeInMemoryLogo(raw: SerializedLogo | null): InMemoryLogo | null {
  if (!raw) return null;
  const bytes = base64ToUint8Bytes(raw.base64);
  const previewUrl = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: raw.mimeType }),
  );
  return {
    fileName: raw.fileName,
    mimeType: raw.mimeType,
    bytes,
    previewUrl,
    needsDarkBackdrop: raw.needsDarkBackdrop,
    pixelWidth: raw.pixelWidth,
    pixelHeight: raw.pixelHeight,
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
    if ((entry.source === 'uploaded' || entry.source === 'discovered') && entry.logo) {
      const serialized = serializeInMemoryLogo(entry.logo);
      if (serialized) {
        customUniversityLogos[key] = {
          universityName: entry.universityName,
          source: entry.source,
          logoSourceUrl: entry.logoSourceUrl,
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

