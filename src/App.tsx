import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  AlertCircle,
  BookOpenCheck,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ImagePlus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { PdfPreviewCanvas } from './components/PdfPreviewCanvas';
import { BRAND_CONFIG, getNonEmptyContactEntries } from './config/brand';
import {
  CHECKLIST_READER_INSTRUCTION,
  DOCUMENT_CHECKLIST_GROUPS,
  GUIDANCE_CHECKED_DATE,
} from './config/ukGuide';
import {
  CURRENCY_OPTIONS,
  type ChecklistSelections,
  type CourseRecord,
  type CurrencyCode,
  type InMemoryLogo,
  type WorkbookSession,
} from './types/course';
import {
  detectWorkbookCurrency,
  parseCoursesFromSheet,
  parseExcelFileInBrowser,
} from './utils/excelParser';
import { loadLogoInMemory } from './utils/logoLoader';
import { generateCourseShortlistPdf } from './utils/pdfGenerator';
import { buildShortlistFilename, formatTuitionFee } from './utils/valueFormatting';

interface PdfPlanMeta {
  pageCount: number;
  coursePageCount: number;
  guideStartPage: number;
  checklistStartPage: number;
}

const TOTAL_CHECKLIST_ITEMS = DOCUMENT_CHECKLIST_GROUPS.reduce(
  (sum, grp) => sum + grp.items.length,
  0,
);

export function App() {
  const studentNameId = useId();
  const studentNameHintId = useId();
  const excelInputId = useId();
  const logoInputId = useId();
  const sheetSelectId = useId();
  const currencySelectId = useId();

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfObjectUrlRef = useRef<string | null>(null);
  const logoObjectUrlRef = useRef<string | null>(null);

  const [studentName, setStudentName] = useState<string>('');
  const [studentNameTouched, setStudentNameTouched] = useState<boolean>(false);

  const [session, setSession] = useState<WorkbookSession | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode | ''>('');
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);

  const [checklistSelections, setChecklistSelections] =
    useState<ChecklistSelections>({});

  const [customLogo, setCustomLogo] = useState<InMemoryLogo | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const [parseError, setParseError] = useState<string | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfPlan, setPdfPlan] = useState<PdfPlanMeta | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);

  const contactEntries = useMemo(() => getNonEmptyContactEntries(), []);
  const trimmedStudentName = studentName.trim();
  const checkedCount = useMemo(
    () => Object.values(checklistSelections).filter(Boolean).length,
    [checklistSelections],
  );

  const revokePdfUrl = useCallback(() => {
    if (pdfObjectUrlRef.current) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current = null;
    }
    setPdfObjectUrl(null);
  }, []);

  const revokeLogoUrl = useCallback(() => {
    if (logoObjectUrlRef.current) {
      URL.revokeObjectURL(logoObjectUrlRef.current);
      logoObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pdfObjectUrlRef.current) {
        URL.revokeObjectURL(pdfObjectUrlRef.current);
        pdfObjectUrlRef.current = null;
      }
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
    };
  }, []);

  // Parse selected worksheet whenever session or selectedSheet changes
  useEffect(() => {
    if (!session || !selectedSheet) {
      setCourses([]);
      return;
    }

    try {
      const parsed = parseCoursesFromSheet(session.sheets, selectedSheet);
      setCourses(parsed);
      setActivePageNumber(1);
      setParseError(null);
    } catch (err) {
      setCourses([]);
      setPdfBytes(null);
      setPdfPlan(null);
      revokePdfUrl();
      setFitError(null);
      setParseError(
        err instanceof Error
          ? err.message
          : 'Unable to validate the selected worksheet.',
      );
    }
  }, [session, selectedSheet, revokePdfUrl]);

  // Generate actual personalized A4 PDF bytes (Courses + Guide + Interactive Checklist)
  useEffect(() => {
    if (courses.length === 0 || !selectedCurrency || !trimmedStudentName) {
      setPdfBytes(null);
      setPdfPlan(null);
      revokePdfUrl();
      setFitError(null);
      setIsGeneratingPdf(false);
      return;
    }

    let cancelled = false;
    setIsGeneratingPdf(true);
    setFitError(null);

    generateCourseShortlistPdf({
      courses,
      currency: selectedCurrency,
      studentName,
      checklistSelections,
      logo: customLogo,
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setPdfBytes(null);
          setPdfPlan(null);
          revokePdfUrl();
          setFitError(result.message);
          setIsGeneratingPdf(false);
          return;
        }

        revokePdfUrl();
        const nextBlob = new Blob([new Uint8Array(result.pdfBytes)], {
          type: 'application/pdf',
        });
        const nextUrl = URL.createObjectURL(nextBlob);
        pdfObjectUrlRef.current = nextUrl;

        setPdfBytes(result.pdfBytes);
        setPdfPlan({
          pageCount: result.pageCount,
          coursePageCount: result.coursePageCount,
          guideStartPage: result.guideStartPage,
          checklistStartPage: result.checklistStartPage,
        });
        setActivePageNumber((prev) =>
          Math.min(Math.max(1, prev), result.pageCount),
        );
        setPdfObjectUrl(nextUrl);
        setFitError(null);
        setIsGeneratingPdf(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPdfBytes(null);
        setPdfPlan(null);
        revokePdfUrl();
        setFitError(
          'PDF generation failed unexpectedly. Please check the workbook values and try again.',
        );
        setIsGeneratingPdf(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    courses,
    selectedCurrency,
    studentName,
    trimmedStudentName,
    checklistSelections,
    customLogo,
    revokePdfUrl,
  ]);

  const handleExcelFile = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    setFitError(null);
    setPdfBytes(null);
    setPdfPlan(null);
    revokePdfUrl();

    try {
      const parsedSession = await parseExcelFileInBrowser(file);
      setSession(parsedSession);
      setSelectedSheet(parsedSession.selectedSheet);
      setSelectedCurrency(parsedSession.detectedCurrency ?? '');
    } catch (err) {
      setSession(null);
      setSelectedSheet('');
      setSelectedCurrency('');
      setCourses([]);
      setParseError(
        err instanceof Error
          ? err.message
          : 'Failed to parse the Excel workbook.',
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleExcelInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleExcelFile(file);
    }
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void handleExcelFile(file);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  };

  const handleSheetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSheet = event.target.value;
    setSelectedSheet(nextSheet);
    if (session) {
      const detected = detectWorkbookCurrency(session.sheets, nextSheet);
      setSession({
        ...session,
        selectedSheet: nextSheet,
        autoSelectedCourseData:
          nextSheet.trim().toLowerCase() === 'course data',
        detectedCurrency: detected.currency,
        currencySource: detected.reason,
      });
      setSelectedCurrency(detected.currency ?? '');
    }
  };

  const handleLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setLogoError(null);
    try {
      const nextLogo = await loadLogoInMemory(file);
      revokeLogoUrl();
      logoObjectUrlRef.current = nextLogo.previewUrl;
      setCustomLogo(nextLogo);
    } catch (err) {
      setLogoError(
        err instanceof Error ? err.message : 'Unable to load logo image.',
      );
    }
  };

  const handleRestoreDefaultLogo = () => {
    revokeLogoUrl();
    setCustomLogo(null);
    setLogoError(null);
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  const handleToggleChecklistItem = (fieldName: string) => {
    setChecklistSelections((prev) => ({
      ...prev,
      [fieldName]: !prev[fieldName],
    }));
  };

  const handleReset = () => {
    revokePdfUrl();
    revokeLogoUrl();
    setStudentName('');
    setStudentNameTouched(false);
    setSession(null);
    setSelectedSheet('');
    setSelectedCurrency('');
    setCourses([]);
    setActivePageNumber(1);
    setChecklistSelections({});
    setCustomLogo(null);
    setParseError(null);
    setFitError(null);
    setLogoError(null);
    setPdfBytes(null);
    setPdfPlan(null);
    setIsParsing(false);
    setIsGeneratingPdf(false);
    setIsDragOver(false);
    if (excelInputRef.current) {
      excelInputRef.current.value = '';
    }
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  const handleDownloadPdf = () => {
    if (!pdfObjectUrl || !canDownload) return;
    const anchor = document.createElement('a');
    anchor.href = pdfObjectUrl;
    anchor.download = buildShortlistFilename(studentName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const studentNameRequiredWarning = Boolean(
    !trimmedStudentName && (studentNameTouched || session),
  );
  const currencyRequired = Boolean(
    session && courses.length > 0 && !selectedCurrency,
  );
  const canDownload = Boolean(
    trimmedStudentName &&
      session &&
      courses.length > 0 &&
      selectedCurrency &&
      pdfBytes &&
      pdfPlan &&
      pdfObjectUrl &&
      !parseError &&
      !fitError &&
      !isParsing &&
      !isGeneratingPdf,
  );

  const hasWorkingState = Boolean(
    studentName ||
      session ||
      customLogo ||
      checkedCount > 0 ||
      parseError ||
      fitError ||
      logoError,
  );

  const headerLogoSrc = customLogo?.previewUrl ?? BRAND_CONFIG.logoAssetPath;
  const totalPreviewPages = pdfPlan?.pageCount ?? courses.length;

  const currentSectionTitle = useMemo(() => {
    if (!pdfPlan) {
      const course = courses[activePageNumber - 1];
      return course?.programName ?? 'PDF Preview';
    }
    if (activePageNumber <= pdfPlan.coursePageCount) {
      return courses[activePageNumber - 1]?.programName ?? 'Course Shortlist';
    }
    if (activePageNumber < pdfPlan.checklistStartPage) {
      return 'UK Application Process';
    }
    return 'Required Documents Checklist';
  }, [pdfPlan, activePageNumber, courses]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand-lockup">
            {headerLogoSrc ? (
              <img
                src={headerLogoSrc}
                alt={`${BRAND_CONFIG.brandName} logo`}
                className="brand-logo-img"
              />
            ) : (
              <div className="brand-wordmark" aria-label={BRAND_CONFIG.brandName}>
                <span className="wordmark-primary">ECCHO</span>
                <span className="wordmark-accent">OVERSEAS</span>
              </div>
            )}
            <div className="brand-meta">
              <h1 className="app-title">Course Shortlist &amp; UK Guide PDF</h1>
              <p className="app-subtitle">
                Private in-browser Excel to personalized A4 PDF
              </p>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleReset}
              disabled={!hasWorkingState && !isParsing && !isGeneratingPdf}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDownloadPdf}
              disabled={!canDownload}
            >
              <Download size={16} aria-hidden="true" />
              Download PDF
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="panel" aria-label="Student personalisation and workbook upload">
          <div className="student-bar">
            <div className="student-field-wrap">
              <label htmlFor={studentNameId} className="field-label">
                Student Name <span className="required-star" aria-hidden="true">*</span>
              </label>
              <input
                id={studentNameId}
                name="studentName"
                type="text"
                required
                placeholder="Enter student's full name (e.g. Aarav Sharma)"
                className={`text-input ${
                  studentNameRequiredWarning ? 'text-input-attention' : ''
                }`}
                value={studentName}
                aria-describedby={studentNameHintId}
                aria-invalid={studentNameRequiredWarning ? 'true' : undefined}
                onChange={(e) => setStudentName(e.target.value)}
                onBlur={() => setStudentNameTouched(true)}
              />
              <p id={studentNameHintId} className="field-hint">
                Used in every PDF header (“Prepared for {trimmedStudentName || 'Student Name'}”),
                the UK guide &amp; checklist, and filename{' '}
                <code>{buildShortlistFilename(studentName)}</code>.
              </p>
            </div>
          </div>

          <div className="intake-grid">
            <div
              className={`dropzone ${isDragOver ? 'dropzone-active' : ''} ${
                session ? 'dropzone-loaded' : ''
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="dropzone-row">
                <div className="dropzone-icon" aria-hidden="true">
                  <FileSpreadsheet size={22} />
                </div>
                <div className="dropzone-copy">
                  <h2 className="dropzone-heading">
                    Upload Course Excel Workbook (.xlsx)
                  </h2>
                  <p className="dropzone-sub">
                    Drag and drop your workbook here or select a file. All data
                    remains strictly in browser memory.
                  </p>
                </div>
                <div>
                  <input
                    ref={excelInputRef}
                    id={excelInputId}
                    type="file"
                    accept=".xlsx,.xlsm"
                    className="visually-hidden"
                    onChange={handleExcelInputChange}
                  />
                  <label
                    htmlFor={excelInputId}
                    className="btn btn-outline dropzone-trigger"
                  >
                    <Upload size={16} aria-hidden="true" />
                    {session ? 'Replace File' : 'Choose Excel File'}
                  </label>
                </div>
              </div>

              {session && (
                <div className="file-meta-pill">
                  <span className="file-name-text" title={session.fileName}>
                    {session.fileName}
                  </span>
                  <span className="badge badge-neutral">
                    {session.sheetNames.length}{' '}
                    {session.sheetNames.length === 1 ? 'sheet' : 'sheets'}
                  </span>
                  {session.autoSelectedCourseData && (
                    <span className="badge badge-green">
                      Auto-selected “Course Data”
                    </span>
                  )}
                </div>
              )}

              {isParsing && (
                <div className="loading-row" role="status" aria-live="polite">
                  <progress
                    aria-label="Parsing Excel workbook"
                    className="loading-spinner"
                  />
                  <span>Parsing workbook in memory…</span>
                </div>
              )}
            </div>

            <div className="config-stack">
              <div className="field-group">
                <div className="field-label-row">
                  <label htmlFor={sheetSelectId} className="field-label">
                    Worksheet Source
                  </label>
                  {session?.autoSelectedCourseData && (
                    <span className="badge badge-green">Authoritative sheet</span>
                  )}
                </div>
                <select
                  id={sheetSelectId}
                  className="select-control"
                  value={selectedSheet}
                  onChange={handleSheetChange}
                  disabled={!session}
                >
                  {!session ? (
                    <option value="">Upload a workbook to select a sheet</option>
                  ) : (
                    session.sheetNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))
                  )}
                </select>
                <p className="field-hint">
                  Automatically uses “Course Data” when present; ignores
                  “Comparison” as extra rows.
                </p>
              </div>

              <div className="field-group">
                <div className="field-label-row">
                  <label htmlFor={currencySelectId} className="field-label">
                    Tuition Fee Currency
                  </label>
                  {session && selectedCurrency && (
                    <span className="badge badge-green">
                      {session.detectedCurrency === selectedCurrency &&
                      session.currencySource
                        ? 'Confirmed from workbook'
                        : 'Confirmed'}
                    </span>
                  )}
                  {currencyRequired && (
                    <span className="badge badge-warn">Required before export</span>
                  )}
                </div>
                <select
                  id={currencySelectId}
                  className={`select-control ${
                    currencyRequired ? 'select-control-attention' : ''
                  }`}
                  value={selectedCurrency}
                  onChange={(e) =>
                    setSelectedCurrency(e.target.value as CurrencyCode | '')
                  }
                  disabled={!session}
                >
                  <option value="">
                    {session
                      ? 'Select tuition currency (required)…'
                      : 'Upload a workbook first'}
                  </option>
                  {CURRENCY_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {session?.currencySource ??
                    'Used to display Yearly Tuition Fee without altering scholarship text.'}
                </p>
              </div>

              <div className="field-group">
                <div className="field-label-row">
                  <span className="field-label">
                    Eccho Overseas Brand Logo (In-Memory)
                  </span>
                </div>
                <div className="logo-control-row">
                  <input
                    ref={logoInputRef}
                    id={logoInputId}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="visually-hidden"
                    onChange={handleLogoChange}
                  />
                  <label htmlFor={logoInputId} className="btn btn-outline btn-sm">
                    <ImagePlus size={15} aria-hidden="true" />
                    {customLogo ? 'Change Custom Logo' : 'Override Logo'}
                  </label>
                  {customLogo ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={handleRestoreDefaultLogo}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Restore Default ({customLogo.fileName})
                    </button>
                  ) : (
                    <span className="field-hint">
                      Using official Eccho Overseas green logo.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <details className="checklist-details">
          <summary className="checklist-summary">
            <span className="checklist-summary-title">
              <ChevronRight
                size={18}
                className="checklist-chevron"
                aria-hidden="true"
              />
              Pre-Export Required Documents Checklist ({checkedCount} of{' '}
              {TOTAL_CHECKLIST_ITEMS} ticked)
            </span>
            <span className="badge badge-green">
              Carried into interactive PDF checkboxes
            </span>
          </summary>

          <div className="checklist-body">
            <div className="checklist-top-bar">
              <p className="checklist-instruction">
                {CHECKLIST_READER_INSTRUCTION} Any items ticked below are
                pre-checked in the generated PDF; no sensitive document numbers or
                files are collected. (Guidance checked on {GUIDANCE_CHECKED_DATE})
              </p>
              {checkedCount > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setChecklistSelections({})}
                >
                  Clear Checklist Selections
                </button>
              )}
            </div>

            <div className="checklist-groups-grid">
              {DOCUMENT_CHECKLIST_GROUPS.map((group) => (
                <section
                  key={group.id}
                  className="checklist-group-card"
                  aria-label={group.title}
                >
                  <h3 className="checklist-group-title">{group.title}</h3>
                  <p className="checklist-group-note">{group.circumstanceNote}</p>
                  <ul className="checklist-items-list">
                    {group.items.map((item) => {
                      const isChecked = Boolean(
                        checklistSelections[item.fieldName],
                      );
                      const isGeneral = item.status === 'Generally required';
                      return (
                        <li key={item.fieldName}>
                          <label className="checklist-item-label">
                            <input
                              type="checkbox"
                              className="checklist-item-checkbox"
                              checked={isChecked}
                              onChange={() =>
                                handleToggleChecklistItem(item.fieldName)
                              }
                            />
                            <span className="checklist-item-text">
                              <span className="checklist-item-header">
                                <span className="checklist-item-name">
                                  {item.label}
                                </span>
                                <span
                                  className={`badge ${
                                    isGeneral ? 'badge-green' : 'badge-neutral'
                                  }`}
                                >
                                  {item.status}
                                </span>
                              </span>
                              <span className="checklist-item-note">
                                {item.note}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </details>

        {logoError && (
          <div role="alert" className="alert-banner alert-error">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-title">Logo upload error</p>
              <p className="alert-detail">{logoError}</p>
            </div>
          </div>
        )}

        {parseError && (
          <div role="alert" className="alert-banner alert-error">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-title">Workbook validation failed</p>
              <p className="alert-detail">{parseError}</p>
            </div>
          </div>
        )}

        {studentNameRequiredWarning && !parseError && (
          <div role="status" aria-live="polite" className="alert-banner alert-warn">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-title">Student Name required</p>
              <p className="alert-detail">
                Enter the Student Name above to personalize the PDF headers, UK
                application guide, interactive checklist, and download filename.
              </p>
            </div>
          </div>
        )}

        {currencyRequired && !parseError && (
          <div role="status" aria-live="polite" className="alert-banner alert-warn">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-title">Currency selection required</p>
              <p className="alert-detail">
                This workbook does not explicitly identify a fee currency. Select
                a Tuition Fee Currency above to generate and download the PDF.
              </p>
            </div>
          </div>
        )}

        {fitError && (
          <div role="alert" className="alert-banner alert-error">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-title">
                Page-fit verification failed — PDF download blocked
              </p>
              <p className="alert-detail">{fitError}</p>
            </div>
          </div>
        )}

        {session && courses.length > 0 && !parseError && (
          <div className="status-strip" role="status" aria-live="polite">
            <div className="status-metrics">
              <span className="metric-item">
                <CheckCircle2 size={16} color="#3d8a3a" aria-hidden="true" />
                <span>
                  Imported courses:{' '}
                  <strong className="metric-value">{courses.length}</strong>
                </span>
              </span>
              <span className="metric-item">
                PDF Structure:{' '}
                <strong className="metric-value">
                  {pdfPlan
                    ? `${pdfPlan.coursePageCount} course pages + UK Guide & Checklist (${pdfPlan.pageCount} pages total)`
                    : `${courses.length} courses (1 course/page) + UK Guide & Checklist`}
                </strong>
              </span>
              {selectedCurrency && (
                <span className="metric-item">
                  Currency:{' '}
                  <strong className="metric-value">{selectedCurrency}</strong>
                </span>
              )}
              {trimmedStudentName && (
                <span className="metric-item">
                  Student:{' '}
                  <strong className="metric-value">{trimmedStudentName}</strong>
                </span>
              )}
            </div>

            {isGeneratingPdf && (
              <div className="loading-row">
                <progress
                  aria-label="Building A4 PDF preview"
                  className="loading-spinner"
                />
                <span>Validating fit &amp; generating PDF…</span>
              </div>
            )}
          </div>
        )}

        {courses.length > 0 && !parseError ? (
          <div className="workspace-grid">
            <aside className="course-sidebar" aria-label="PDF document navigation">
              <div className="sidebar-header">
                <h2 className="sidebar-title">
                  Courses ({courses.length})
                </h2>
                <span className="badge badge-green">Source Order</span>
              </div>
              <ol className="course-list">
                {courses.map((course, idx) => {
                  const targetPage = idx + 1;
                  const isActive = activePageNumber === targetPage;
                  const feeLabel = selectedCurrency
                    ? formatTuitionFee(course.yearlyTuitionFee, selectedCurrency)
                    : 'Select currency';
                  return (
                    <li key={`${course.rowNumber}-${course.programName}`}>
                      <button
                        type="button"
                        className={`course-nav-item ${
                          isActive ? 'course-nav-item-active' : ''
                        }`}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setActivePageNumber(targetPage)}
                      >
                        <span className="course-index-pill">{targetPage}</span>
                        <span className="course-nav-copy">
                          <span className="course-nav-program">
                            {course.programName}
                          </span>
                          <span className="course-nav-uni">
                            {course.university}
                          </span>
                          <span className="course-nav-fee">{feeLabel}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {pdfPlan && (
                <>
                  <div className="sidebar-section-divider">
                    Guidance &amp; Checklist
                  </div>
                  <ul className="guide-nav-list">
                    <li>
                      <button
                        type="button"
                        className={`course-nav-item ${
                          activePageNumber >= pdfPlan.guideStartPage &&
                          activePageNumber < pdfPlan.checklistStartPage
                            ? 'course-nav-item-active'
                            : ''
                        }`}
                        onClick={() =>
                          setActivePageNumber(pdfPlan.guideStartPage)
                        }
                      >
                        <span className="course-index-pill" aria-hidden="true">
                          <BookOpenCheck size={13} />
                        </span>
                        <span className="course-nav-copy">
                          <span className="course-nav-program">
                            UK Application Process
                          </span>
                          <span className="course-nav-uni">
                            Page {pdfPlan.guideStartPage} · Admissions vs UKVI
                          </span>
                        </span>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className={`course-nav-item ${
                          activePageNumber >= pdfPlan.checklistStartPage
                            ? 'course-nav-item-active'
                            : ''
                        }`}
                        onClick={() =>
                          setActivePageNumber(pdfPlan.checklistStartPage)
                        }
                      >
                        <span className="course-index-pill" aria-hidden="true">
                          <CheckSquare size={13} />
                        </span>
                        <span className="course-nav-copy">
                          <span className="course-nav-program">
                            Required Documents Checklist
                          </span>
                          <span className="course-nav-uni">
                            Page {pdfPlan.checklistStartPage} · Interactive PDF
                            boxes
                          </span>
                        </span>
                      </button>
                    </li>
                  </ul>
                </>
              )}
            </aside>

            <section className="preview-panel" aria-label="PDF page preview">
              <div className="preview-toolbar">
                <div className="preview-heading-block">
                  <h2 className="preview-title">{currentSectionTitle}</h2>
                  <p className="preview-caption">
                    Rendered directly from the generated A4 PDF — click links on
                    the page to jump between sections
                  </p>
                </div>

                <div className="preview-nav-controls">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      setActivePageNumber((prev) => Math.max(1, prev - 1))
                    }
                    disabled={activePageNumber <= 1}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                    Previous
                  </button>
                  <span className="page-counter">
                    Page {activePageNumber} of {totalPreviewPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      setActivePageNumber((prev) =>
                        Math.min(totalPreviewPages, prev + 1),
                      )
                    }
                    disabled={activePageNumber >= totalPreviewPages}
                  >
                    Next
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="preview-stage-wrap">
                {pdfBytes ? (
                  <PdfPreviewCanvas
                    pdfBytes={pdfBytes}
                    pageNumber={activePageNumber}
                    pageTitle={currentSectionTitle}
                    onNavigatePage={(targetPage) =>
                      setActivePageNumber(
                        Math.min(Math.max(1, targetPage), totalPreviewPages),
                      )
                    }
                  />
                ) : isGeneratingPdf ? (
                  <div className="loading-row" role="status" aria-live="polite">
                    <progress
                      aria-label="Generating PDF preview"
                      className="loading-spinner"
                    />
                    <span>Measuring layout and building PDF pages…</span>
                  </div>
                ) : (
                  <div className="empty-state">
                    <h3 className="empty-state-title">
                      {!trimmedStudentName
                        ? 'Enter Student Name to generate the personalized PDF'
                        : currencyRequired
                          ? 'Select a currency to render the PDF preview'
                          : 'PDF preview unavailable'}
                    </h3>
                    <p className="empty-state-body">
                      {fitError
                        ? 'Resolve the single-page fit issue reported above to preview and export.'
                        : !trimmedStudentName
                          ? 'Fill in the required Student Name field above to personalize every page and enable PDF preview and download.'
                          : 'Choose the confirmed tuition currency above to generate and inspect every A4 page.'}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          !isParsing &&
          !parseError && (
            <section className="empty-state" aria-label="Getting started">
              <h2 className="empty-state-title">
                Ready to build a personalized Eccho Overseas shortlist PDF
              </h2>
              <p className="empty-state-body">
                Enter the student’s name and upload an Excel workbook (.xlsx).
                Each course from “Course Data” becomes one A4 portrait page,
                followed by the clickable UK Application Process guide and
                interactive Required Documents Checklist.
              </p>
            </section>
          )
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <span>
            {BRAND_CONFIG.brandName} · Client-side only (no student data stored or
            transmitted)
          </span>
          {contactEntries.length > 0 && (
            <span>
              {contactEntries.map((c) => `${c.label}: ${c.value}`).join(' · ')}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;
