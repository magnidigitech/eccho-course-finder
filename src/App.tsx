import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  Building2,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  Landmark,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { PdfPreviewCanvas } from './components/PdfPreviewCanvas';
import { BRAND_CONFIG } from './config/brand';
import {
  CHECKLIST_READER_INSTRUCTION,
  DOCUMENT_CHECKLIST_GROUPS,
  GUIDANCE_CHECKED_DATE,
  OFFICIAL_GUIDANCE_LINKS,
  UK_APPLICATION_STEPS,
} from './config/ukGuide';
import {
  CURRENCY_OPTIONS,
  type ChecklistSelections,
  type CourseRecord,
  type CurrencyCode,
  type InMemoryLogo,
  type UniversityLogoEntry,
  type UniversityLogoMap,
  type WorkbookSession,
} from './types/course';
import {
  ExcelValidationError,
  parseCoursesFromSheet,
  parseExcelFileInBrowser,
} from './utils/excelParser';
import {
  clearExtensionSessionState,
  deserializeInMemoryLogo,
  isChromeExtensionTab,
  loadExtensionSessionState,
  registerExtensionConverterTab,
  saveExtensionSessionState,
} from './utils/extensionSession';
import { loadLogoInMemory, revokeLogoPreviewUrl } from './utils/logoLoader';
import { inspectProcessedLogoPixels } from './utils/logoProcessor';
import { generateCourseShortlistPdf } from './utils/pdfGenerator';
import {
  applyCandidateSelection,
  collectPendingHostOrigins,
  discoverSingleUniversityEntry,
  fetchPendingExternalHostCandidate,
  findAlreadyPermittedUniversityKeys,
  getUniversityInitials,
  initializeUniversityLogosForCourses,
  requestHostPermissionsSync,
  revokeEntryCandidateUrls,
  revokeUniversityLogoUrls,
  runWithConcurrencyLimit,
} from './utils/universityLogos';
import {
  NOT_SPECIFIED,
  buildShortlistFilename,
  formatTuitionFee,
} from './utils/valueFormatting';

type ActiveSection =
  | { kind: 'summary' }
  | { kind: 'course'; index: number }
  | { kind: 'guide' }
  | { kind: 'checklist' };

type ViewMode = 'structured' | 'pdf';

interface PdfMeta {
  pdfBytes: Uint8Array;
  pageCount: number;
  summaryPageCount: number;
  courseStartPage: number;
  coursePageCount: number;
  guideStartPage: number;
  checklistStartPage: number;
}

function UniversityLogoBox({
  entry,
  universityName,
  overrideLogo,
}: {
  entry?: UniversityLogoEntry;
  universityName: string;
  overrideLogo?: InMemoryLogo | null;
}) {
  const logoToUse = overrideLogo ?? entry?.logo ?? null;
  const initials = entry?.initials ?? getUniversityInitials(universityName);
  const darkClass = logoToUse?.needsDarkBackdrop ? ' is-dark-backdrop' : '';
  return (
    <div className={`univ-logo-frame${darkClass}`}>
      {logoToUse ? (
        <img src={logoToUse.previewUrl} alt={`${universityName} logo`} />
      ) : (
        <span
          className="univ-logo-initials"
          aria-label={`${universityName} initials`}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

function CandidatePickerGrid({
  entry,
  universityName,
  ariaLabel,
  onSelect,
}: {
  entry: UniversityLogoEntry;
  universityName: string;
  ariaLabel: string;
  onSelect: (candidateId: string) => void;
}) {
  if (!entry.candidates || entry.candidates.length === 0) return null;
  return (
    <div className="candidate-picker-grid" role="group" aria-label={ariaLabel}>
      {entry.candidates.map((cand) => (
        <button
          key={cand.id}
          type="button"
          className={`candidate-option-btn${
            entry.logo?.previewUrl === cand.logo.previewUrl ? ' is-selected' : ''
          }`}
          onClick={() => onSelect(cand.id)}
        >
          <UniversityLogoBox
            universityName={universityName}
            overrideLogo={cand.logo}
          />
          <span className="candidate-option-meta">
            {cand.sourceLabel}
            {cand.logo.pixelWidth && cand.logo.pixelHeight
              ? ` (${cand.logo.pixelWidth}×${cand.logo.pixelHeight})`
              : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

function splitAcademicDisplayLine(
  line: string,
): { label: string; value: string } | null {
  const match = line.match(/^([^:\n]{2,56}):\s+(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  if (!label || !value || /^https?$/i.test(label)) return null;
  return { label, value };
}

function formatDestinationCountries(courses: CourseRecord[]): string {
  const countries: string[] = [];
  const seen = new Set<string>();
  for (const c of courses) {
    if (c.country === NOT_SPECIFIED) continue;
    const key = c.country.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      countries.push(c.country.trim());
    }
  }
  if (countries.length === 0) return 'Destination not specified';
  if (countries.length <= 2) return countries.join(', ');
  return `${countries[0]} + ${countries.length - 1} more`;
}

export function App() {
  const inExtensionTab = useMemo(() => isChromeExtensionTab(), []);

  const [studentName, setStudentName] = useState<string>('');
  const [workbookSession, setWorkbookSession] =
    useState<WorkbookSession | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [pendingSheetChoice, setPendingSheetChoice] = useState<string[] | null>(
    null,
  );
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode | ''>(
    '',
  );
  const [checklistSelections, setChecklistSelections] =
    useState<ChecklistSelections>({});
  const [customBrandLogo, setCustomBrandLogo] = useState<InMemoryLogo | null>(
    null,
  );
  const [universityLogos, setUniversityLogos] = useState<UniversityLogoMap>({});

  const [activeSection, setActiveSection] = useState<ActiveSection>({
    kind: 'summary',
  });
  const [viewMode, setViewMode] = useState<ViewMode>('structured');
  const [activePdfPage, setActivePdfPage] = useState<number>(1);
  const [pdfMeta, setPdfMeta] = useState<PdfMeta | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [sessionHydrated, setSessionHydrated] = useState<boolean>(!inExtensionTab);

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const brandLogoInputRef = useRef<HTMLInputElement | null>(null);
  const univLogoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const customBrandLogoRef = useRef<InMemoryLogo | null>(null);
  const universityLogosRef = useRef<UniversityLogoMap>({});
  const resetEpochRef = useRef<number>(0);
  const univRunTokensRef = useRef<Record<string, number>>({});
  customBrandLogoRef.current = customBrandLogo;
  universityLogosRef.current = universityLogos;

  const activeCurrency: CurrencyCode | null = useMemo(() => {
    if (selectedCurrency) return selectedCurrency;
    return workbookSession?.detectedCurrency ?? null;
  }, [selectedCurrency, workbookSession]);

  const effectiveBrandLogoSrc =
    customBrandLogo?.previewUrl ?? BRAND_CONFIG.logoAssetPath ?? '';

  const trimmedStudentName = studentName.trim();
  const uniqueUniversities = useMemo(() => {
    const list: CourseRecord[] = [];
    const seen = new Set<string>();
    for (const c of courses) {
      if (seen.has(c.universityKey)) continue;
      seen.add(c.universityKey);
      list.push(c);
    }
    return list;
  }, [courses]);

  const tickedChecklistCount = useMemo(
    () => Object.values(checklistSelections).filter(Boolean).length,
    [checklistSelections],
  );
  const totalChecklistCount = useMemo(
    () =>
      DOCUMENT_CHECKLIST_GROUPS.reduce((sum, g) => sum + g.items.length, 0),
    [],
  );

  // Revoke in-memory object URLs on final unmount
  useEffect(() => {
    return () => {
      revokeLogoPreviewUrl(customBrandLogoRef.current);
      revokeUniversityLogoUrls(universityLogosRef.current);
    };
  }, []);

  // Chrome extension tab registration & ephemeral session restore
  useEffect(() => {
    if (!inExtensionTab) return;
    let cancelled = false;

    void (async () => {
      await registerExtensionConverterTab();
      const saved = await loadExtensionSessionState();
      if (cancelled || !saved) {
        setSessionHydrated(true);
        return;
      }

      setStudentName(saved.studentName);
      setChecklistSelections(saved.checklistSelections ?? {});
      setSelectedCurrency(saved.selectedCurrency ?? '');

      if (saved.customBrandLogo) {
        const restoredBrand = deserializeInMemoryLogo(saved.customBrandLogo);
        if (restoredBrand) setCustomBrandLogo(restoredBrand);
      }

      if (saved.workbookSession && saved.selectedSheet) {
        try {
          const parsedCourses = parseCoursesFromSheet(
            saved.workbookSession.sheets,
            saved.selectedSheet,
          );
          const seedMap: UniversityLogoMap = {};
          for (const [key, entry] of Object.entries(
            saved.customUniversityLogos ?? {},
          )) {
            const deserialized = deserializeInMemoryLogo(entry.logo);
            if (deserialized) {
              seedMap[key] = {
                universityKey: key,
                universityName: entry.universityName,
                websiteHref: null,
                normalizedWebsiteUrl: null,
                finalWebsiteUrl: null,
                domain: null,
                requiredHostOrigins: [],
                initials: getUniversityInitials(entry.universityName),
                source: entry.source,
                status: 'found',
                logo: deserialized,
                logoSourceUrl: entry.logoSourceUrl ?? null,
                statusMessage:
                  entry.source === 'uploaded'
                    ? 'Custom uploaded logo'
                    : 'Discovered from university website',
              };
            }
          }
          const initializedLogos = initializeUniversityLogosForCourses(
            parsedCourses,
            seedMap,
          );
          if (!cancelled) {
            setWorkbookSession(saved.workbookSession);
            setSelectedSheet(saved.selectedSheet);
            setCourses(parsedCourses);
            setUniversityLogos(initializedLogos);
            setActivePdfPage(Math.max(1, saved.activePageNumber || 1));
          }
        } catch {
          // Fallback cleanly if restored sheet could not be parsed
        }
      }

      if (!cancelled) {
        setSessionHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inExtensionTab]);

  // Persist ephemeral extension session (never runs on regular Vercel web app)
  useEffect(() => {
    if (!inExtensionTab || !sessionHydrated) return;
    const handle = window.setTimeout(() => {
      void saveExtensionSessionState({
        studentName,
        workbookSession,
        selectedSheet,
        selectedCurrency,
        activePageNumber: activePdfPage,
        checklistSelections,
        customBrandLogo,
        universityLogos,
      });
    }, 180);
    return () => window.clearTimeout(handle);
  }, [
    inExtensionTab,
    sessionHydrated,
    studentName,
    workbookSession,
    selectedSheet,
    selectedCurrency,
    activePdfPage,
    checklistSelections,
    customBrandLogo,
    universityLogos,
  ]);

  // Regenerate live PDF document whenever inputs settle
  useEffect(() => {
    if (courses.length === 0 || !trimmedStudentName || !activeCurrency) {
      setPdfMeta(null);
      return;
    }

    let cancelled = false;
    setIsGeneratingPdf(true);

    const timer = window.setTimeout(() => {
      void generateCourseShortlistPdf({
        courses,
        currency: activeCurrency,
        studentName: trimmedStudentName,
        checklistSelections,
        universityLogos,
        logo: customBrandLogo,
      })
        .then((res) => {
          if (cancelled) return;
          setIsGeneratingPdf(false);
          if (res.ok) {
            setErrorMessage(null);
            setPdfMeta({
              pdfBytes: res.pdfBytes,
              pageCount: res.pageCount,
              summaryPageCount: res.summaryPageCount,
              courseStartPage: res.courseStartPage,
              coursePageCount: res.coursePageCount,
              guideStartPage: res.guideStartPage,
              checklistStartPage: res.checklistStartPage,
            });
            setActivePdfPage((prev) =>
              prev < 1 ? 1 : prev > res.pageCount ? res.pageCount : prev,
            );
          } else {
            setPdfMeta(null);
            setErrorMessage(res.message);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setIsGeneratingPdf(false);
          setPdfMeta(null);
          setErrorMessage(
            'Could not generate the PDF in browser memory. Check the spreadsheet data and try again.',
          );
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    courses,
    trimmedStudentName,
    activeCurrency,
    checklistSelections,
    universityLogos,
    customBrandLogo,
  ]);

  const runDiscoveryForKeys = async (
    keys: string[],
    seedMap?: UniversityLogoMap,
  ) => {
    if (keys.length === 0) return;
    const epoch = resetEpochRef.current;
    const baseMap = { ...(seedMap ?? universityLogosRef.current) };
    const perKeyToken: Record<string, number> = {};

    for (const key of keys) {
      const nextToken = (univRunTokensRef.current[key] ?? 0) + 1;
      univRunTokensRef.current[key] = nextToken;
      perKeyToken[key] = nextToken;
    }

    setUniversityLogos((prev) => {
      const next = { ...(seedMap ?? prev) };
      for (const key of keys) {
        const entry = next[key];
        if (entry) {
          next[key] = {
            ...entry,
            status: 'finding',
            statusMessage: 'Inspecting university homepage for official logos…',
          };
        }
      }
      return next;
    });

    await runWithConcurrencyLimit(keys, 2, async (key) => {
      if (
        resetEpochRef.current !== epoch ||
        univRunTokensRef.current[key] !== perKeyToken[key]
      ) {
        return;
      }
      const currentEntry = baseMap[key] ?? universityLogosRef.current[key];
      if (!currentEntry) return;

      const discovered = await discoverSingleUniversityEntry(currentEntry);
      if (
        resetEpochRef.current !== epoch ||
        univRunTokensRef.current[key] !== perKeyToken[key]
      ) {
        revokeEntryCandidateUrls(discovered);
        return;
      }

      setUniversityLogos((prev) => {
        const prevEntry = prev[key];
        const keepUrl = discovered.logo?.previewUrl ?? null;
        if (prevEntry && prevEntry !== discovered) {
          revokeEntryCandidateUrls(prevEntry, keepUrl);
        }
        return {
          ...prev,
          [key]: discovered,
        };
      });
    });
  };

  const applyWorksheet = async (
    session: WorkbookSession,
    sheetName: string,
  ) => {
    resetEpochRef.current += 1;
    univRunTokensRef.current = {};
    const parsedCourses = parseCoursesFromSheet(session.sheets, sheetName);
    const initializedLogos = initializeUniversityLogosForCourses(
      parsedCourses,
      universityLogosRef.current,
    );
    revokeUniversityLogoUrls(universityLogosRef.current);

    setWorkbookSession(session);
    setSelectedSheet(sheetName);
    setPendingSheetChoice(null);
    setCourses(parsedCourses);
    setSelectedCurrency(session.detectedCurrency ?? 'GBP');
    setUniversityLogos(initializedLogos);
    setActiveSection({ kind: 'summary' });
    setActivePdfPage(1);
    setErrorMessage(null);

    if (inExtensionTab) {
      const permittedKeys =
        await findAlreadyPermittedUniversityKeys(initializedLogos);
      if (permittedKeys.length > 0) {
        void runDiscoveryForKeys(permittedKeys, initializedLogos);
      }
    }
  };

  const handleExcelFile = async (file: File) => {
    setErrorMessage(null);
    try {
      const session = await parseExcelFileInBrowser(file);
      if (session.autoSelectedCourseData || session.sheetNames.length === 1) {
        await applyWorksheet(session, session.selectedSheet);
      } else {
        setWorkbookSession(session);
        setPendingSheetChoice(session.sheetNames);
      }
    } catch (err) {
      if (err instanceof ExcelValidationError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Could not read the selected Excel file.');
      }
    }
  };

  const handleExcelInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleExcelFile(file);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleExcelFile(file);
    }
  };

  const handleReset = () => {
    resetEpochRef.current += 1;
    univRunTokensRef.current = {};
    revokeLogoPreviewUrl(customBrandLogoRef.current);
    revokeUniversityLogoUrls(universityLogosRef.current);

    setStudentName('');
    setWorkbookSession(null);
    setSelectedSheet('');
    setPendingSheetChoice(null);
    setCourses([]);
    setSelectedCurrency('');
    setChecklistSelections({});
    setCustomBrandLogo(null);
    setUniversityLogos({});
    setActiveSection({ kind: 'summary' });
    setViewMode('structured');
    setActivePdfPage(1);
    setPdfMeta(null);
    setErrorMessage(null);

    if (excelInputRef.current) excelInputRef.current.value = '';
    if (brandLogoInputRef.current) brandLogoInputRef.current.value = '';

    if (inExtensionTab) {
      void clearExtensionSessionState();
    }
  };

  const handleBrandLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const loaded = await loadLogoInMemory(file);
      revokeLogoPreviewUrl(customBrandLogoRef.current);
      setCustomBrandLogo(loaded);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not load brand logo image.',
      );
    }
  };

  const handleUniversityLogoUpload = async (
    course: CourseRecord,
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const loaded = await loadLogoInMemory(file);
      const pixelMetrics = await inspectProcessedLogoPixels(
        loaded.bytes,
        loaded.mimeType,
      ).catch(() => null);
      const enrichedLogo: InMemoryLogo = pixelMetrics
        ? {
            ...loaded,
            needsDarkBackdrop: pixelMetrics.needsDarkBackdrop,
            pixelWidth: pixelMetrics.width,
            pixelHeight: pixelMetrics.height,
          }
        : loaded;

      const prevEntry = universityLogosRef.current[course.universityKey];
      revokeEntryCandidateUrls(prevEntry, enrichedLogo.previewUrl);

      setUniversityLogos((prev) => ({
        ...prev,
        [course.universityKey]: {
          ...(prev[course.universityKey] ?? {
            universityKey: course.universityKey,
            universityName: course.university,
            websiteHref: course.websiteHref,
            normalizedWebsiteUrl: null,
            finalWebsiteUrl: null,
            domain: null,
            requiredHostOrigins: [],
            initials: getUniversityInitials(course.university),
          }),
          source: 'uploaded',
          status: 'found',
          logo: enrichedLogo,
          logoSourceUrl: null,
          statusMessage: enrichedLogo.needsDarkBackdrop
            ? `Custom uploaded (${loaded.fileName}) — dark frame applied`
            : `Custom uploaded (${loaded.fileName})`,
        },
      }));
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not load the selected university logo.',
      );
    }
  };

  // CRITICAL: Calls chrome.permissions.request synchronously in user click handler before any await.
  const handleStartBulkDiscovery = () => {
    const origins = collectPendingHostOrigins(universityLogosRef.current);
    const targetKeys = Object.values(universityLogosRef.current)
      .filter((e) => e.status === 'permission_required' && e.normalizedWebsiteUrl)
      .map((e) => e.universityKey);

    if (origins.length === 0) {
      void runDiscoveryForKeys(targetKeys);
      return;
    }

    const permissionPromise = requestHostPermissionsSync(origins);
    void permissionPromise.then((granted) => {
      if (granted) {
        void runDiscoveryForKeys(targetKeys);
      } else {
        setUniversityLogos((prev) => {
          const next = { ...prev };
          for (const key of targetKeys) {
            if (next[key]) {
              next[key] = {
                ...next[key],
                status: 'unavailable',
                statusMessage:
                  'Host access permission was declined. Using initials placeholder or manual upload.',
              };
            }
          }
          return next;
        });
      }
    });
  };

  const handleRequestOrRetryUniversityDiscovery = (course: CourseRecord) => {
    const entry = universityLogosRef.current[course.universityKey];
    if (!entry || !entry.normalizedWebsiteUrl) return;

    if (entry.requiredHostOrigins.length > 0 && inExtensionTab) {
      const permPromise = requestHostPermissionsSync(entry.requiredHostOrigins);
      void permPromise.then((granted) => {
        if (granted) {
          void runDiscoveryForKeys([course.universityKey]);
        } else {
          setUniversityLogos((prev) => ({
            ...prev,
            [course.universityKey]: {
              ...prev[course.universityKey],
              status: 'unavailable',
              statusMessage: `Host access declined for ${entry.domain ?? 'this university website'}.`,
            },
          }));
        }
      });
    }
  };

  const handleGrantExternalHostDownload = (
    universityKey: string,
    pendingIdx: number,
  ) => {
    const entry = universityLogosRef.current[universityKey];
    const pending = entry?.pendingExternalHosts?.[pendingIdx];
    if (!entry || !pending) return;

    const permPromise = requestHostPermissionsSync([pending.originPattern]);
    void permPromise.then(async (granted) => {
      if (!granted) {
        setUniversityLogos((prev) => ({
          ...prev,
          [universityKey]: {
            ...prev[universityKey],
            statusMessage: `Access declined for external image host ${pending.origin}.`,
          },
        }));
        return;
      }
      setUniversityLogos((prev) => ({
        ...prev,
        [universityKey]: {
          ...prev[universityKey],
          status: 'finding',
          statusMessage: `Downloading candidate logo from ${pending.origin}…`,
        },
      }));
      const updated = await fetchPendingExternalHostCandidate(entry, pending);
      setUniversityLogos((prev) => ({
        ...prev,
        [universityKey]: updated,
      }));
    });
  };

  const handleSelectCandidate = (universityKey: string, candidateId: string) => {
    setUniversityLogos((prev) => {
      const current = prev[universityKey];
      if (!current) return prev;
      return {
        ...prev,
        [universityKey]: applyCandidateSelection(current, candidateId),
      };
    });
  };

  const handleDownloadPdf = async () => {
    if (!trimmedStudentName) {
      setErrorMessage('Enter Student Name before downloading the PDF.');
      return;
    }
    if (courses.length === 0 || !activeCurrency) {
      setErrorMessage('Upload a valid Excel course file first.');
      return;
    }

    setIsDownloadingPdf(true);
    try {
      const res = await generateCourseShortlistPdf({
        courses,
        currency: activeCurrency,
        studentName: trimmedStudentName,
        checklistSelections,
        universityLogos,
        logo: customBrandLogo,
      });
      if (!res.ok) {
        setErrorMessage(res.message);
        return;
      }

      const blob = new Blob([new Uint8Array(res.pdfBytes)], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildShortlistFilename(trimmedStudentName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const navigateToSection = (target: ActiveSection) => {
    setActiveSection(target);
    if (!pdfMeta) return;
    if (target.kind === 'summary') {
      setActivePdfPage(1);
    } else if (target.kind === 'course') {
      setActivePdfPage(pdfMeta.courseStartPage + target.index);
    } else if (target.kind === 'guide') {
      setActivePdfPage(pdfMeta.guideStartPage);
    } else {
      setActivePdfPage(pdfMeta.checklistStartPage);
    }
  };

  const handlePdfPageNavigation = (pageNumber: number) => {
    setActivePdfPage(pageNumber);
    if (!pdfMeta) return;
    if (pageNumber <= pdfMeta.summaryPageCount) {
      setActiveSection({ kind: 'summary' });
    } else if (
      pageNumber >= pdfMeta.courseStartPage &&
      pageNumber < pdfMeta.courseStartPage + pdfMeta.coursePageCount
    ) {
      setActiveSection({
        kind: 'course',
        index: pageNumber - pdfMeta.courseStartPage,
      });
    } else if (
      pageNumber >= pdfMeta.guideStartPage &&
      pageNumber < pdfMeta.checklistStartPage
    ) {
      setActiveSection({ kind: 'guide' });
    } else {
      setActiveSection({ kind: 'checklist' });
    }
  };

  const toggleChecklistItem = (fieldName: string) => {
    setChecklistSelections((prev) => ({
      ...prev,
      [fieldName]: !prev[fieldName],
    }));
  };

  const destinationLabel = useMemo(
    () => formatDestinationCountries(courses),
    [courses],
  );

  const activeCourse =
    activeSection.kind === 'course'
      ? (courses[activeSection.index] ?? courses[0])
      : null;

  const activePageTitle = useMemo(() => {
    if (!pdfMeta) return 'Course Shortlist Preview';
    if (activePdfPage <= pdfMeta.summaryPageCount) {
      return 'Personalised Course Shortlist Summary';
    }
    if (
      activePdfPage >= pdfMeta.courseStartPage &&
      activePdfPage < pdfMeta.courseStartPage + pdfMeta.coursePageCount
    ) {
      const idx = activePdfPage - pdfMeta.courseStartPage;
      return courses[idx]?.programName ?? 'Course Page';
    }
    if (
      activePdfPage >= pdfMeta.guideStartPage &&
      activePdfPage < pdfMeta.checklistStartPage
    ) {
      return 'UK Application Process';
    }
    return 'Required Documents Checklist';
  }, [activePdfPage, courses, pdfMeta]);

  const currencyLabel = useMemo(() => {
    const match = CURRENCY_OPTIONS.find((c) => c.code === activeCurrency);
    return match ? match.label : activeCurrency || 'GBP';
  }, [activeCurrency]);

  const summaryPageCount = pdfMeta?.summaryPageCount ?? 1;
  const courseStartPage = pdfMeta?.courseStartPage ?? 2;
  const guideStartPage = pdfMeta?.guideStartPage ?? 2 + courses.length;
  const checklistStartPage =
    pdfMeta?.checklistStartPage ?? guideStartPage + 2;

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand-lockup">
            {effectiveBrandLogoSrc ? (
              <img
                src={effectiveBrandLogoSrc}
                alt={BRAND_CONFIG.brandName}
                className="brand-logo-img"
              />
            ) : (
              <strong>{BRAND_CONFIG.brandName}</strong>
            )}
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-subtitle">Course Shortlist Converter</span>
          </div>

          <div className="header-actions">
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="visually-hidden"
              onChange={handleExcelInputChange}
            />
            <input
              ref={brandLogoInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
              className="visually-hidden"
              onChange={handleBrandLogoUpload}
            />

            {courses.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => excelInputRef.current?.click()}
                >
                  <Upload size={15} aria-hidden="true" />
                  Replace Excel
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleReset}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    isDownloadingPdf ||
                    !trimmedStudentName ||
                    courses.length === 0
                  }
                  onClick={handleDownloadPdf}
                >
                  {isDownloadingPdf ? (
                    <Loader2
                      size={15}
                      className="spin-icon"
                      aria-hidden="true"
                    />
                  ) : (
                    <Download size={15} aria-hidden="true" />
                  )}
                  Download Branded PDF
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="main-container">
        {errorMessage && (
          <div role="alert" className="notice-banner notice-error">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {courses.length === 0 ? (
          <section className="onboarding-wrapper" aria-label="Course Shortlist Setup">
            <div className="onboarding-intro">
              <h1>Eccho Overseas Course Shortlist</h1>
              <p>
                Processed locally in your browser — upload an Excel sheet to
                preview courses and export a branded A4 shortlist PDF.
              </p>
            </div>

            <div className="onboarding-card">
              <div className="field-group">
                <label htmlFor="student-name-input" className="field-label">
                  Student Name <span className="field-required">*</span>
                </label>
                <input
                  id="student-name-input"
                  type="text"
                  autoComplete="off"
                  className="field-input"
                  placeholder="Enter student full name (e.g. Ananya Sharma)"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                />
                <p className="field-hint">
                  Preserved verbatim in PDF headers, toolkit pages, and the
                  download filename. Kept strictly in memory.
                </p>
              </div>

              <div className="field-group">
                <span className="field-label">
                  Upload Course Workbook (.xlsx)
                </span>
                <div
                  role="button"
                  tabIndex={0}
                  className={`dropzone${isDragging ? ' is-dragging' : ''}`}
                  onClick={() => excelInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      excelInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <div className="dropzone-icon">
                    <FileSpreadsheet size={20} aria-hidden="true" />
                  </div>
                  <p className="dropzone-title">
                    Drop your Eccho Excel workbook here, or click to browse
                  </p>
                  <p className="dropzone-meta">
                    Reads “Course Data” automatically when present. “Comparison”
                    is never imported as extra courses.
                  </p>
                  <span className="btn btn-subtle">
                    <Upload size={15} aria-hidden="true" />
                    Select Excel File
                  </span>
                </div>
              </div>

              <details className="secondary-details">
                <summary>Optional: Customise Eccho Overseas brand logo</summary>
                <div className="secondary-details-body">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => brandLogoInputRef.current?.click()}
                  >
                    <ImageIcon size={14} aria-hidden="true" />
                    Upload Replacement Logo
                  </button>
                  {customBrandLogo && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        revokeLogoPreviewUrl(customBrandLogo);
                        setCustomBrandLogo(null);
                      }}
                    >
                      Restore Default Logo
                    </button>
                  )}
                </div>
              </details>
            </div>
          </section>
        ) : (
          <>
            <div className="workspace-toolbar">
              <div className="toolbar-fields">
                <div className="toolbar-field student-name-field">
                  <label htmlFor="workspace-student-name" className="toolbar-label">
                    Student Name *
                  </label>
                  <input
                    id="workspace-student-name"
                    type="text"
                    autoComplete="off"
                    className="field-input"
                    placeholder="Enter student name"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                  />
                </div>

                {workbookSession?.detectedCurrency ? (
                  <div className="toolbar-field">
                    <span className="toolbar-label">Currency</span>
                    <span className="currency-pill">
                      <Coins size={14} aria-hidden="true" />
                      {currencyLabel}
                    </span>
                  </div>
                ) : (
                  <div className="toolbar-field">
                    <label htmlFor="currency-select" className="toolbar-label">
                      Confirm Fee Currency
                    </label>
                    <select
                      id="currency-select"
                      className="field-select"
                      value={selectedCurrency}
                      onChange={(e) =>
                        setSelectedCurrency(e.target.value as CurrencyCode)
                      }
                    >
                      {CURRENCY_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {workbookSession && workbookSession.sheetNames.length > 1 && (
                  <div className="toolbar-field">
                    <label htmlFor="sheet-select" className="toolbar-label">
                      Worksheet
                    </label>
                    <select
                      id="sheet-select"
                      className="field-select"
                      value={selectedSheet}
                      onChange={(e) => {
                        if (workbookSession) {
                          void applyWorksheet(workbookSession, e.target.value);
                        }
                      }}
                    >
                      {workbookSession.sheetNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="view-tabs" role="tablist" aria-label="Preview mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'structured'}
                  className={`view-tab${viewMode === 'structured' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('structured')}
                >
                  Shortlist Preview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'pdf'}
                  className={`view-tab${viewMode === 'pdf' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('pdf')}
                >
                  Rendered PDF{pdfMeta ? ` (${pdfMeta.pageCount}p)` : ''}
                </button>
              </div>
            </div>

            {!trimmedStudentName && (
              <div className="notice-banner notice-warning">
                <AlertCircle size={18} aria-hidden="true" />
                <span>
                  Enter <strong>Student Name</strong> above to unlock live PDF
                  preview and download.
                </span>
              </div>
            )}

            <div className="workspace-grid">
              <aside className="sidebar" aria-label="Shortlist navigation">
                <div className="sidebar-card">
                  <div className="sidebar-card-header">
                    <h2 className="sidebar-card-title">Shortlist Structure</h2>
                    <span className="nav-page-tag">
                      {courses.length} {courses.length === 1 ? 'course' : 'courses'}
                    </span>
                  </div>
                  <div className="nav-list">
                    <button
                      type="button"
                      className={`nav-item${activeSection.kind === 'summary' ? ' is-active' : ''}`}
                      onClick={() => navigateToSection({ kind: 'summary' })}
                    >
                      <span className="nav-index">
                        <Landmark size={13} aria-hidden="true" />
                      </span>
                      <span className="nav-item-text">
                        <span className="nav-item-primary">
                          Personalised Summary
                        </span>
                        <span className="nav-item-secondary">
                          {courses.length} courses · {uniqueUniversities.length}{' '}
                          universities
                        </span>
                      </span>
                      <span className="nav-page-tag">
                        {summaryPageCount === 1
                          ? 'p.1'
                          : `p.1–${summaryPageCount}`}
                      </span>
                    </button>

                    {courses.map((course, idx) => (
                      <button
                        key={`${course.rowNumber}-${course.programName}`}
                        type="button"
                        className={`nav-item${activeSection.kind === 'course' &&
                          activeSection.index === idx
                          ? ' is-active'
                          : ''
                          }`}
                        onClick={() =>
                          navigateToSection({ kind: 'course', index: idx })
                        }
                      >
                        <span className="nav-index">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="nav-item-text">
                          <span className="nav-item-primary">
                            {course.programName}
                          </span>
                          <span className="nav-item-secondary">
                            {course.university}
                          </span>
                        </span>
                        <span className="nav-page-tag">
                          p.{courseStartPage + idx}
                        </span>
                      </button>
                    ))}

                    <button
                      type="button"
                      className={`nav-item${activeSection.kind === 'guide' ? ' is-active' : ''}`}
                      onClick={() => navigateToSection({ kind: 'guide' })}
                    >
                      <span className="nav-index">
                        <FileText size={13} aria-hidden="true" />
                      </span>
                      <span className="nav-item-text">
                        <span className="nav-item-primary">
                          UK Application Process
                        </span>
                        <span className="nav-item-secondary">
                          6-step guide &amp; official sources
                        </span>
                      </span>
                      <span className="nav-page-tag">p.{guideStartPage}</span>
                    </button>

                    <button
                      type="button"
                      className={`nav-item${activeSection.kind === 'checklist' ? ' is-active' : ''}`}
                      onClick={() => navigateToSection({ kind: 'checklist' })}
                    >
                      <span className="nav-index">
                        <CheckSquare size={13} aria-hidden="true" />
                      </span>
                      <span className="nav-item-text">
                        <span className="nav-item-primary">
                          Required Documents Checklist
                        </span>
                        <span className="nav-item-secondary">
                          {tickedChecklistCount}/{totalChecklistCount} ticked
                        </span>
                      </span>
                      <span className="nav-page-tag">
                        p.{checklistStartPage}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="sidebar-card">
                  <div className="sidebar-card-header">
                    <h2 className="sidebar-card-title">University Logos</h2>
                    <span className="nav-page-tag">
                      {uniqueUniversities.length} unique
                    </span>
                  </div>

                  {inExtensionTab &&
                    Object.values(universityLogos).some(
                      (e) =>
                        e.status === 'permission_required' &&
                        e.normalizedWebsiteUrl,
                    ) && (
                      <div className="discovery-consent-box">
                        <strong>Online University Logo Discovery</strong>
                        <span>
                          Grant temporary read access only to fetch public
                          homepage logos (no student or spreadsheet data is
                          sent):
                        </span>
                        <p className="discovery-domain-list">
                          {Object.values(universityLogos)
                            .filter(
                              (e) =>
                                e.status === 'permission_required' && e.domain,
                            )
                            .map((e) => e.domain)
                            .join(', ')}
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={handleStartBulkDiscovery}
                        >
                          <Globe size={13} aria-hidden="true" />
                          Discover University Logos
                        </button>
                      </div>
                    )}

                  <div className="logo-manager-list">
                    {uniqueUniversities.map((course) => {
                      const entry = universityLogos[course.universityKey];
                      const status = entry?.status ?? 'unavailable';
                      const statusLabel =
                        status === 'finding'
                          ? 'Finding logo…'
                          : status === 'found'
                            ? entry?.source === 'uploaded'
                              ? 'Found (Custom upload)'
                              : 'Found'
                            : status === 'needs_selection'
                              ? 'Needs selection'
                              : status === 'permission_required'
                                ? 'Needs permission'
                                : 'Unavailable';

                      return (
                        <div
                          key={course.universityKey}
                          className="logo-manager-row"
                        >
                          <div className="logo-manager-head">
                            <UniversityLogoBox
                              entry={entry}
                              universityName={course.university}
                            />
                            <div className="logo-manager-meta">
                              <span className="logo-manager-name">
                                {course.university}
                              </span>
                              <span
                                className={`logo-status-pill${
                                  status === 'found'
                                    ? ' is-found'
                                    : status === 'needs_selection' ||
                                        status === 'permission_required'
                                      ? ' is-selection'
                                      : ''
                                }`}
                              >
                                {status === 'finding' && (
                                  <Loader2
                                    size={11}
                                    className="spin-icon"
                                    aria-hidden="true"
                                  />
                                )}
                                {statusLabel}
                              </span>
                              {entry?.logoSourceUrl && (
                                <a
                                  href={entry.logoSourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="logo-source-url"
                                  title={entry.logoSourceUrl}
                                >
                                  {entry.logoSourceUrl}
                                </a>
                              )}
                            </div>
                          </div>

                          <input
                            ref={(el) => {
                              univLogoInputRefs.current[course.universityKey] =
                                el;
                            }}
                            type="file"
                            accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                            className="visually-hidden"
                            onChange={(e) =>
                              void handleUniversityLogoUpload(course, e)
                            }
                          />

                          {entry &&
                            entry.candidates &&
                            entry.candidates.length > 0 &&
                            status === 'needs_selection' && (
                              <CandidatePickerGrid
                                entry={entry}
                                universityName={course.university}
                                ariaLabel={`Logo candidates for ${course.university}`}
                                onSelect={(candId) =>
                                  handleSelectCandidate(
                                    course.universityKey,
                                    candId,
                                  )
                                }
                              />
                            )}

                          {entry &&
                            entry.candidates &&
                            entry.candidates.length > 1 &&
                            status === 'found' && (
                              <details className="secondary-details">
                                <summary>
                                  Switch candidate ({entry.candidates.length})
                                </summary>
                                <CandidatePickerGrid
                                  entry={entry}
                                  universityName={course.university}
                                  ariaLabel={`Alternative logo candidates for ${course.university}`}
                                  onSelect={(candId) =>
                                    handleSelectCandidate(
                                      course.universityKey,
                                      candId,
                                    )
                                  }
                                />
                              </details>
                            )}

                          {inExtensionTab &&
                            entry?.pendingExternalHosts &&
                            entry.pendingExternalHosts.length > 0 && (
                              <div className="logo-manager-actions">
                                {entry.pendingExternalHosts.map((ext, idx) => (
                                  <button
                                    key={ext.candidateUrl}
                                    type="button"
                                    className="btn btn-sm btn-subtle"
                                    onClick={() =>
                                      handleGrantExternalHostDownload(
                                        course.universityKey,
                                        idx,
                                      )
                                    }
                                  >
                                    <Globe size={12} aria-hidden="true" />
                                    Allow {ext.origin.replace(/^https?:\/\//, '')}
                                  </button>
                                ))}
                              </div>
                            )}

                          <div className="logo-manager-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() =>
                                univLogoInputRefs.current[
                                  course.universityKey
                                ]?.click()
                              }
                            >
                              <Upload size={12} aria-hidden="true" />
                              {entry?.logo ? 'Replace' : 'Upload Logo'}
                            </button>

                            {inExtensionTab && entry?.normalizedWebsiteUrl && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={status === 'finding'}
                                onClick={() =>
                                  handleRequestOrRetryUniversityDiscovery(
                                    course,
                                  )
                                }
                              >
                                <RefreshCw size={12} aria-hidden="true" />
                                {status === 'permission_required'
                                  ? `Allow ${entry.domain ?? 'site'}`
                                  : 'Retry'}
                              </button>
                            )}
                          </div>

                          {entry?.statusMessage && (
                            <p className="logo-lookup-note">
                              {entry.statusMessage}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </aside>

              <section className="preview-stage" aria-label="Document preview">
                {viewMode === 'pdf' ? (
                  <>
                    <div className="pdf-preview-bar">
                      <div className="header-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!pdfMeta || activePdfPage <= 1}
                          onClick={() =>
                            handlePdfPageNavigation(
                              Math.max(1, activePdfPage - 1),
                            )
                          }
                        >
                          <ChevronLeft size={14} aria-hidden="true" />
                          Previous
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={
                            !pdfMeta || activePdfPage >= pdfMeta.pageCount
                          }
                          onClick={() =>
                            handlePdfPageNavigation(
                              Math.min(
                                pdfMeta?.pageCount ?? 1,
                                activePdfPage + 1,
                              ),
                            )
                          }
                        >
                          Next
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <span className="brand-subtitle">
                        {pdfMeta
                          ? `Page ${activePdfPage} of ${pdfMeta.pageCount} — ${activePageTitle}`
                          : 'Enter Student Name to preview rendered PDF'}
                      </span>
                    </div>

                    <div className="pdf-preview-body">
                      {!trimmedStudentName ? (
                        <div className="pdf-preview-loading">
                          Enter Student Name above to render the personalised
                          PDF preview.
                        </div>
                      ) : isGeneratingPdf && !pdfMeta ? (
                        <div className="pdf-preview-loading">
                          Generating personalised A4 PDF…
                        </div>
                      ) : pdfMeta ? (
                        <PdfPreviewCanvas
                          pdfBytes={pdfMeta.pdfBytes}
                          pageNumber={activePdfPage}
                          pageTitle={activePageTitle}
                          onNavigatePage={handlePdfPageNavigation}
                        />
                      ) : (
                        <div className="pdf-preview-error">
                          PDF preview unavailable until generation succeeds.
                        </div>
                      )}
                    </div>
                  </>
                ) : activeSection.kind === 'summary' ? (
                  <article className="sheet-document">
                    <div className="sheet-topbar">
                      <div className="sheet-topbar-left">
                        {effectiveBrandLogoSrc && (
                          <img
                            src={effectiveBrandLogoSrc}
                            alt={BRAND_CONFIG.brandName}
                            className="sheet-topbar-logo"
                          />
                        )}
                      </div>
                      <span className="sheet-topbar-kicker">
                        Personalised Course Shortlist
                      </span>
                    </div>

                    <div className="summary-hero">
                      <h1>Your Personalised Course Shortlist</h1>
                      <p className="summary-subtitle">
                        Prepared for{' '}
                        {trimmedStudentName || '[Enter Student Name]'}
                      </p>

                      <div className="stats-strip">
                        <span className="stat-chip">
                          <GraduationCap size={16} aria-hidden="true" />
                          {courses.length}{' '}
                          {courses.length === 1 ? 'course' : 'courses'}
                        </span>
                        <span className="stat-sep" aria-hidden="true" />
                        <span className="stat-chip">
                          <Landmark size={16} aria-hidden="true" />
                          {uniqueUniversities.length}{' '}
                          {uniqueUniversities.length === 1
                            ? 'university'
                            : 'universities'}
                        </span>
                        <span className="stat-sep" aria-hidden="true" />
                        <span className="stat-chip">
                          <MapPin size={16} aria-hidden="true" />
                          {destinationLabel}
                        </span>
                      </div>
                    </div>

                    <div className="summary-rows">
                      {courses.map((course, idx) => (
                        <div
                          key={`${course.rowNumber}-${course.programName}`}
                          className="summary-row"
                        >
                          <UniversityLogoBox
                            entry={universityLogos[course.universityKey]}
                            universityName={course.university}
                          />
                          <div className="summary-row-title">
                            <div className="summary-univ">
                              {course.university}
                            </div>
                            <div className="summary-course">
                              {course.programName}
                            </div>
                          </div>
                          <div className="summary-location">
                            <MapPin size={14} aria-hidden="true" />
                            <span>
                              {course.campus !== NOT_SPECIFIED
                                ? course.campus
                                : course.country}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              navigateToSection({ kind: 'course', index: idx })
                            }
                          >
                            View course
                            <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="toolkit-section">
                      <h2 className="toolkit-heading">
                        Your Application Toolkit
                      </h2>
                      <button
                        type="button"
                        className="toolkit-row"
                        onClick={() => navigateToSection({ kind: 'guide' })}
                      >
                        <span className="toolkit-row-left">
                          <FileText size={16} aria-hidden="true" />
                          <strong>UK Application Process</strong>
                          <span className="toolkit-row-sub">
                            — 6-step admissions &amp; Student visa guide
                          </span>
                        </span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        className="toolkit-row"
                        onClick={() => navigateToSection({ kind: 'checklist' })}
                      >
                        <span className="toolkit-row-left">
                          <CheckSquare size={16} aria-hidden="true" />
                          <strong>Required Documents Checklist</strong>
                          <span className="toolkit-row-sub">
                            — Interactive checklist to tick and save
                          </span>
                        </span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ) : activeSection.kind === 'course' && activeCourse ? (
                  <article className="sheet-document">
                    <div className="sheet-topbar">
                      <div className="sheet-topbar-left">
                        {effectiveBrandLogoSrc && (
                          <img
                            src={effectiveBrandLogoSrc}
                            alt={BRAND_CONFIG.brandName}
                            className="sheet-topbar-logo"
                          />
                        )}
                        <span className="sheet-topbar-prepared">
                          Prepared for{' '}
                          {trimmedStudentName || '[Student Name]'}
                        </span>
                      </div>
                      <span className="sheet-topbar-kicker">
                        Course {String(activeSection.index + 1).padStart(2, '0')}{' '}
                        / {String(courses.length).padStart(2, '0')}
                      </span>
                    </div>

                    <div className="sheet-back-strip">
                      <button
                        type="button"
                        className="link-back-btn"
                        onClick={() => navigateToSection({ kind: 'summary' })}
                      >
                        <ArrowLeft size={14} aria-hidden="true" />
                        Back to shortlist
                      </button>
                      {pdfMeta && (
                        <button
                          type="button"
                          className="btn btn-sm btn-subtle"
                          onClick={() => setViewMode('pdf')}
                        >
                          <Eye size={13} aria-hidden="true" />
                          Inspect PDF Page {courseStartPage + activeSection.index}
                        </button>
                      )}
                    </div>

                    <div className="course-header-identity">
                      <UniversityLogoBox
                        entry={universityLogos[activeCourse.universityKey]}
                        universityName={activeCourse.university}
                      />
                      <div>
                        <p className="course-univ-name">
                          {activeCourse.university}
                        </p>
                        <div className="course-location-line">
                          <MapPin size={14} aria-hidden="true" />
                          <span>
                            {activeCourse.campus !== NOT_SPECIFIED &&
                              activeCourse.country !== NOT_SPECIFIED
                              ? `${activeCourse.campus} / ${activeCourse.country}`
                              : activeCourse.campus !== NOT_SPECIFIED
                                ? activeCourse.campus
                                : activeCourse.country}
                          </span>
                        </div>
                      </div>
                    </div>

                    <h1 className="course-title">{activeCourse.programName}</h1>

                    <section className="doc-section">
                      <h2 className="doc-section-title">Overview</h2>
                      <div className="overview-grid">
                        <div className="overview-item">
                          <GraduationCap size={17} aria-hidden="true" />
                          <div>
                            <div className="overview-label">Study level</div>
                            <div className="overview-value">
                              {activeCourse.studyLevel}
                            </div>
                          </div>
                        </div>

                        <div className="overview-item">
                          <Clock size={17} aria-hidden="true" />
                          <div>
                            <div className="overview-label">Duration</div>
                            <div className="overview-value">
                              {activeCourse.duration}
                            </div>
                          </div>
                        </div>

                        <div className="overview-item">
                          <Calendar size={17} aria-hidden="true" />
                          <div>
                            <div className="overview-label">Open intake</div>
                            <div className="overview-value">
                              {activeCourse.openIntake}
                            </div>
                          </div>
                        </div>

                        {activeCourse.faculty !== null && (
                          <div className="overview-item">
                            <Building2 size={17} aria-hidden="true" />
                            <div>
                              <div className="overview-label">Faculty</div>
                              <div className="overview-value">
                                {activeCourse.faculty}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="doc-section">
                      <h2 className="doc-section-title">Fees</h2>
                      <div className="fees-grid">
                        <div className="sage-panel">
                          <Coins size={18} aria-hidden="true" />
                          <div>
                            <div className="overview-label">
                              Yearly tuition fee
                            </div>
                            <div
                              className={
                                activeCourse.yearlyTuitionFee.kind === 'text'
                                  ? 'fee-text'
                                  : 'fee-amount'
                              }
                            >
                              {formatTuitionFee(
                                activeCourse.yearlyTuitionFee,
                                activeCurrency,
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="sage-panel">
                          <Award size={18} aria-hidden="true" />
                          <div>
                            <div className="overview-label">
                              Scholarship available
                            </div>
                            <div className="fee-text">
                              {activeCourse.scholarshipAvailable}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="doc-section">
                      <h2 className="doc-section-title">
                        Academic entry requirements
                      </h2>
                      <div className="academic-table">
                        {(activeCourse.entryRequirementLines.length > 0
                          ? activeCourse.entryRequirementLines
                          : [NOT_SPECIFIED]
                        ).map((line, idx) => {
                          const split = splitAcademicDisplayLine(line);
                          return (
                            <div key={idx} className="academic-row">
                              {split ? (
                                <>
                                  <span className="academic-label">
                                    {split.label}
                                  </span>
                                  <span className="academic-value">
                                    {split.value}
                                  </span>
                                </>
                              ) : (
                                <span className="academic-label">{line}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <section className="doc-section">
                      <h2 className="doc-section-title">
                        English language requirements
                      </h2>
                      <div className="english-grid">
                        {activeCourse.englishTests.map((test) => {
                          const isMissing = test.value === NOT_SPECIFIED;
                          return (
                            <div key={test.key} className="english-cell">
                              <div className="english-test-label">
                                {test.label}
                              </div>
                              <div
                                className={`english-test-value${isMissing ? ' is-missing' : ''
                                  }`}
                              >
                                {test.value}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <section className="doc-section">
                      <h2 className="doc-section-title">Waiver criteria</h2>
                      <div className="waiver-grid">
                        {activeCourse.englishWaivers.map((waiver) => {
                          const isMissing = waiver.value === NOT_SPECIFIED;
                          return (
                            <div key={waiver.key} className="waiver-cell">
                              <div className="english-test-label">
                                {waiver.label}
                              </div>
                              <div
                                className={`english-test-value${isMissing ? ' is-missing' : ''
                                  }`}
                              >
                                {waiver.value}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <div className="quick-toolkit-pair">
                      <button
                        type="button"
                        className="toolkit-row"
                        onClick={() => navigateToSection({ kind: 'guide' })}
                      >
                        <span className="toolkit-row-left">
                          <FileText size={15} aria-hidden="true" />
                          <strong>UK Application Process</strong>
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="toolkit-row"
                        onClick={() => navigateToSection({ kind: 'checklist' })}
                      >
                        <span className="toolkit-row-left">
                          <CheckSquare size={15} aria-hidden="true" />
                          <strong>Documents Checklist</strong>
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </div>

                    <footer className="sheet-footer">
                      {activeCourse.websiteHref ? (
                        <a
                          href={activeCourse.websiteHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sheet-website-link"
                        >
                          {activeCourse.websiteUrlDisplay.replace(
                            /^https?:\/\//i,
                            '',
                          )}
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      ) : (
                        <span>Website not specified</span>
                      )}
                      <span>
                        Fees, scholarships, dates and entry requirements are subject to
                        change. Confirm with your Counsellor from Eccho Overseas.
                      </span>
                    </footer>
                  </article>
                ) : activeSection.kind === 'guide' ? (
                  <article className="sheet-document">
                    <div className="sheet-topbar">
                      <div className="sheet-topbar-left">
                        {effectiveBrandLogoSrc && (
                          <img
                            src={effectiveBrandLogoSrc}
                            alt={BRAND_CONFIG.brandName}
                            className="sheet-topbar-logo"
                          />
                        )}
                        <span className="sheet-topbar-prepared">
                          Prepared for{' '}
                          {trimmedStudentName || '[Student Name]'}
                        </span>
                      </div>
                      <span className="sheet-topbar-kicker">
                        UK Application Process
                      </span>
                    </div>

                    <div className="sheet-back-strip">
                      <button
                        type="button"
                        className="link-back-btn"
                        onClick={() => navigateToSection({ kind: 'summary' })}
                      >
                        <ArrowLeft size={14} aria-hidden="true" />
                        Back to shortlist
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-subtle"
                        onClick={() => navigateToSection({ kind: 'checklist' })}
                      >
                        Required Documents Checklist
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </div>

                    <h1 className="course-title">UK Application Process</h1>
                    <p className="summary-subtitle">
                      University admission rules are set by each institution and
                      differ from UKVI Student visa requirements.
                    </p>

                    <div className="guide-step-list">
                      {UK_APPLICATION_STEPS.map((step) => (
                        <div key={step.number} className="guide-step-card">
                          <div className="guide-step-top">
                            <div className="guide-step-title-wrap">
                              <span className="step-badge">
                                {String(step.number).padStart(2, '0')}
                              </span>
                              <strong>{step.title}</strong>
                            </div>
                            <span
                              className={`guide-cat-tag${step.scope === 'UK Student Visa (UKVI)'
                                ? ' is-visa'
                                : ''
                                }`}
                            >
                              {step.scope}
                            </span>
                          </div>
                          <p>{step.summary}</p>
                          <ul>
                            {step.details.map((bullet, idx) => (
                              <li key={idx}>{bullet}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>

                    <div className="official-links-box">
                      <div className="guide-step-top">
                        <strong>Official UK Guidance Sources</strong>
                        <span className="field-hint">
                          Guidance checked on {GUIDANCE_CHECKED_DATE}
                        </span>
                      </div>
                      <div className="official-links-list">
                        {OFFICIAL_GUIDANCE_LINKS.map((link) => (
                          <div key={link.url} className="official-link-row">
                            <span>{link.label}</span>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="sheet-website-link"
                            >
                              {link.url}
                              <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                ) : (
                  <article className="sheet-document">
                    <div className="sheet-topbar">
                      <div className="sheet-topbar-left">
                        {effectiveBrandLogoSrc && (
                          <img
                            src={effectiveBrandLogoSrc}
                            alt={BRAND_CONFIG.brandName}
                            className="sheet-topbar-logo"
                          />
                        )}
                        <span className="sheet-topbar-prepared">
                          Prepared for{' '}
                          {trimmedStudentName || '[Student Name]'}
                        </span>
                      </div>
                      <span className="sheet-topbar-kicker">
                        Required Documents Checklist
                      </span>
                    </div>

                    <div className="sheet-back-strip">
                      <button
                        type="button"
                        className="link-back-btn"
                        onClick={() => navigateToSection({ kind: 'summary' })}
                      >
                        <ArrowLeft size={14} aria-hidden="true" />
                        Back to shortlist
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-subtle"
                        onClick={() => navigateToSection({ kind: 'guide' })}
                      >
                        UK Application Process
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </div>

                    <h1 className="course-title">
                      Required Documents Checklist
                    </h1>

                    <div className="notice-banner notice-sage">
                      <CheckSquare size={17} aria-hidden="true" />
                      <span>
                        {CHECKLIST_READER_INSTRUCTION} Ticking items here also
                        pre-fills your exported PDF checkboxes.
                      </span>
                    </div>

                    {DOCUMENT_CHECKLIST_GROUPS.map((group) => (
                      <div key={group.id} className="checklist-group-card">
                        <div className="checklist-group-head">
                          <h3>{group.title}</h3>
                          <p>{group.circumstanceNote}</p>
                        </div>
                        {group.items.map((item) => {
                          const checked = Boolean(
                            checklistSelections[item.fieldName],
                          );
                          return (
                            <div
                              key={item.fieldName}
                              className="checklist-row"
                            >
                              <label className="checklist-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    toggleChecklistItem(item.fieldName)
                                  }
                                />
                                <span>
                                  <span className="checklist-item-name">
                                    {item.label}
                                  </span>
                                  <br />
                                  <span className="checklist-item-note">
                                    {item.note}
                                  </span>
                                </span>
                              </label>
                              <span
                                className={`status-pill${item.status === 'If applicable'
                                  ? ' is-conditional'
                                  : ''
                                  }`}
                              >
                                {item.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </article>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      <footer className="site-footer">
        {BRAND_CONFIG.brandName} · Local browser processing · Student data and
        spreadsheets never leave your device
      </footer>

      {pendingSheetChoice && workbookSession && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-picker-title"
          className="modal-backdrop"
        >
          <div className="modal-card">
            <h2 id="sheet-picker-title">Select Course Worksheet</h2>
            <p className="field-hint">
              This workbook does not contain a sheet named “Course Data”.
              Choose which worksheet holds one course per row:
            </p>
            <div className="sheet-choice-list">
              {pendingSheetChoice.map((sheetName) => (
                <button
                  key={sheetName}
                  type="button"
                  className="sheet-choice-btn"
                  onClick={() => void applyWorksheet(workbookSession, sheetName)}
                >
                  <span>{sheetName}</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => setPendingSheetChoice(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
