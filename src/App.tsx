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
  CheckCircle2,
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
  CURRENCY_OPTIONS,
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

export function App() {
  const excelInputId = useId();
  const logoInputId = useId();
  const sheetSelectId = useId();
  const currencySelectId = useId();

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfObjectUrlRef = useRef<string | null>(null);
  const logoObjectUrlRef = useRef<string | null>(null);

  const [session, setSession] = useState<WorkbookSession | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode | ''>('');
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [activeCourseIndex, setActiveCourseIndex] = useState<number>(0);

  const [logo, setLogo] = useState<InMemoryLogo | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const [parseError, setParseError] = useState<string | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);

  const contactEntries = useMemo(() => getNonEmptyContactEntries(), []);

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

  // Cleanup any object URLs on unmount
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
      setActiveCourseIndex(0);
      setParseError(null);
    } catch (err) {
      setCourses([]);
      setPdfBytes(null);
      revokePdfUrl();
      setFitError(null);
      setParseError(
        err instanceof Error
          ? err.message
          : 'Unable to validate the selected worksheet.',
      );
    }
  }, [session, selectedSheet, revokePdfUrl]);

  // Generate actual A4 PDF bytes whenever validated courses, confirmed currency, or logo change
  useEffect(() => {
    if (courses.length === 0 || !selectedCurrency) {
      setPdfBytes(null);
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
      logo,
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setPdfBytes(null);
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
        setPdfObjectUrl(nextUrl);
        setFitError(null);
        setIsGeneratingPdf(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPdfBytes(null);
        revokePdfUrl();
        setFitError(
          'PDF generation failed unexpectedly. Please check the workbook values and try again.',
        );
        setIsGeneratingPdf(false);
      });

    return () => {
      cancelled = true;
    };
  }, [courses, selectedCurrency, logo, revokePdfUrl]);

  const handleExcelFile = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    setFitError(null);
    setPdfBytes(null);
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
    // Reset input value so selecting the same file again triggers onChange
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
      setLogo(nextLogo);
    } catch (err) {
      setLogoError(
        err instanceof Error ? err.message : 'Unable to load logo image.',
      );
    }
  };

  const handleRemoveLogo = () => {
    revokeLogoUrl();
    setLogo(null);
    setLogoError(null);
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  const handleReset = () => {
    revokePdfUrl();
    revokeLogoUrl();
    setSession(null);
    setSelectedSheet('');
    setSelectedCurrency('');
    setCourses([]);
    setActiveCourseIndex(0);
    setLogo(null);
    setParseError(null);
    setFitError(null);
    setLogoError(null);
    setPdfBytes(null);
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
    anchor.download = buildShortlistFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const currencyRequired = Boolean(
    session && courses.length > 0 && !selectedCurrency,
  );
  const canDownload = Boolean(
    session &&
      courses.length > 0 &&
      selectedCurrency &&
      pdfBytes &&
      pdfObjectUrl &&
      !parseError &&
      !fitError &&
      !isParsing &&
      !isGeneratingPdf,
  );

  const hasWorkingState = Boolean(
    session || logo || parseError || fitError || logoError,
  );
  const activeCourse = courses[activeCourseIndex] ?? null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand-lockup">
            {logo ? (
              <img
                src={logo.previewUrl}
                alt={`${BRAND_CONFIG.brandName} logo`}
                className="brand-logo-thumb"
              />
            ) : (
              <div className="brand-wordmark" aria-label={BRAND_CONFIG.brandName}>
                <span className="wordmark-primary">ECCHO</span>
                <span className="wordmark-accent">OVERSEAS</span>
              </div>
            )}
            <div className="brand-meta">
              <h1 className="app-title">Course Shortlist PDF Generator</h1>
              <p className="app-subtitle">
                Private in-browser Excel to A4 single-course-per-page PDF
              </p>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn btn-secondary-light"
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
        <section className="panel" aria-label="Workbook upload and export settings">
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
                    Drag and drop your workbook here or select a file. Data stays
                    strictly in browser memory.
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
                  <span className="badge badge-navy">
                    {session.sheetNames.length}{' '}
                    {session.sheetNames.length === 1 ? 'sheet' : 'sheets'}
                  </span>
                  {session.autoSelectedCourseData && (
                    <span className="badge badge-success">
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
                    <span className="badge badge-navy">Authoritative sheet</span>
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
                    <span className="badge badge-success">
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
                    Optional Header Logo (In-Memory)
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
                    {logo ? 'Change Logo' : 'Upload Logo'}
                  </label>
                  {logo && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={handleRemoveLogo}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Remove ({logo.fileName})
                    </button>
                  )}
                  {!logo && (
                    <span className="field-hint">
                      Defaults to “ECCHO OVERSEAS” text wordmark.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

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
                <CheckCircle2 size={16} color="#065f46" aria-hidden="true" />
                <span>
                  Imported courses:{' '}
                  <strong className="metric-value">{courses.length}</strong>
                </span>
              </span>
              <span className="metric-item">
                Layout:{' '}
                <strong className="metric-value">
                  A4 Portrait · {courses.length}{' '}
                  {courses.length === 1 ? 'page' : 'pages'} (1 course/page)
                </strong>
              </span>
              {selectedCurrency && (
                <span className="metric-item">
                  Currency:{' '}
                  <strong className="metric-value">{selectedCurrency}</strong>
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
            <aside className="course-sidebar" aria-label="Imported courses">
              <div className="sidebar-header">
                <h2 className="sidebar-title">
                  Courses ({courses.length})
                </h2>
                <span className="badge badge-navy">Source Order</span>
              </div>
              <ol className="course-list">
                {courses.map((course, idx) => {
                  const isActive = idx === activeCourseIndex;
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
                        onClick={() => setActiveCourseIndex(idx)}
                      >
                        <span className="course-index-pill">{idx + 1}</span>
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
            </aside>

            <section className="preview-panel" aria-label="PDF page preview">
              <div className="preview-toolbar">
                <div className="preview-heading-block">
                  <h2 className="preview-title">
                    {activeCourse?.programName ?? 'PDF Preview'}
                  </h2>
                  <p className="preview-caption">
                    Rendered directly from the generated A4 PDF — identical to
                    the downloaded file
                  </p>
                </div>

                <div className="preview-nav-controls">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      setActiveCourseIndex((prev) => Math.max(0, prev - 1))
                    }
                    disabled={activeCourseIndex <= 0}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                    Previous
                  </button>
                  <span className="page-counter">
                    Page {activeCourseIndex + 1} of {courses.length}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      setActiveCourseIndex((prev) =>
                        Math.min(courses.length - 1, prev + 1),
                      )
                    }
                    disabled={activeCourseIndex >= courses.length - 1}
                  >
                    Next
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="preview-stage-wrap">
                {pdfBytes && activeCourse ? (
                  <PdfPreviewCanvas
                    pdfBytes={pdfBytes}
                    pageNumber={activeCourseIndex + 1}
                    courseTitle={activeCourse.programName}
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
                      {currencyRequired
                        ? 'Select a currency to render the PDF preview'
                        : 'PDF preview unavailable'}
                    </h3>
                    <p className="empty-state-body">
                      {fitError
                        ? 'Resolve the single-page fit issue reported above to preview and export.'
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
                Ready to convert your Eccho Overseas course shortlist
              </h2>
              <p className="empty-state-body">
                Upload an Excel workbook (.xlsx). When a “Course Data” worksheet
                is present it is selected automatically; each row becomes one
                branded A4 portrait page with complete entry requirements,
                scholarships, English test scores, waiver rules, and a clickable
                university link.
              </p>
            </section>
          )
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <span>
            {BRAND_CONFIG.brandName} · Client-side only (no files uploaded or
            stored)
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

