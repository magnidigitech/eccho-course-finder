export interface OfficialGuidanceLink {
  label: string;
  url: string;
}

export interface GuideStep {
  number: number;
  title: string;
  scope: 'University Admissions' | 'UK Student Visa (UKVI)' | 'Admissions & Visa';
  summary: string;
  details: string[];
}

export type ChecklistRequirementStatus = 'Generally required' | 'If applicable';

export interface ChecklistItem {
  fieldName: string;
  label: string;
  status: ChecklistRequirementStatus;
  note: string;
}

export interface ChecklistGroup {
  id: 'university_application' | 'cas_preparation' | 'uk_student_visa' | 'before_travel';
  title: string;
  circumstanceNote: string;
  items: ChecklistItem[];
}

export const GUIDANCE_CHECKED_DATE = '11 November 2026';

export const CHECKLIST_READER_INSTRUCTION =
  'Download and open in a PDF reader that supports interactive forms to tick and save your checklist.';

export const OFFICIAL_GUIDANCE_LINKS: OfficialGuidanceLink[] = [
  {
    label: 'GOV.UK — Student visa overview, fees & current rules',
    url: 'https://www.gov.uk/student-visa',
  },
  {
    label: 'GOV.UK — Your course & Confirmation of Acceptance for Studies (CAS)',
    url: 'https://www.gov.uk/student-visa/course',
  },
  {
    label: 'GOV.UK — Documents you must provide',
    url: 'https://www.gov.uk/student-visa/documents-you-must-provide',
  },
  {
    label: 'GOV.UK — Money you need (maintenance & 28-day rule)',
    url: 'https://www.gov.uk/student-visa/money',
  },
  {
    label: 'GOV.UK — Knowledge of English for Student visa',
    url: 'https://www.gov.uk/student-visa/knowledge-of-english',
  },
  {
    label: 'GOV.UK — Apply online from outside the UK',
    url: 'https://www.gov.uk/student-visa/apply-online',
  },
  {
    label: 'GOV.UK — Academic Technology Approval Scheme (ATAS)',
    url: 'https://www.gov.uk/guidance/academic-technology-approval-scheme',
  },
  {
    label: 'GOV.UK — Tuberculosis (TB) test requirements & clinics',
    url: 'https://www.gov.uk/tb-test-visa',
  },
  {
    label: 'GOV.UK — Immigration Health Surcharge (IHS)',
    url: 'https://www.gov.uk/healthcare-immigration-application',
  },
  {
    label: 'GOV.UK — Digital UK immigration status (eVisa & UKVI account)',
    url: 'https://www.gov.uk/evisa',
  },
  {
    label: 'UKCISA — Student route eligibility & requirements',
    url: 'https://www.ukcisa.org.uk/student-advice/visas-and-immigration/student-route-eligibility-and-requirements/',
  },
];

export const UK_APPLICATION_STEPS: GuideStep[] = [
  {
    number: 1,
    title: 'Course and university selection',
    scope: 'University Admissions',
    summary:
      'Compare shortlisted UK programmes against your academic background, English proficiency, intake dates, and budget before applying.',
    details: [
      'University entry criteria (grades, degree classification, prerequisites, and campus options) are set individually by each institution and differ from UK Student visa rules.',
      'Confirm that the university holds an active UK Student sponsor licence for your chosen campus and delivery mode.',
    ],
  },
  {
    number: 2,
    title: 'Application and supporting documents',
    scope: 'University Admissions',
    summary:
      'Submit complete applications through the university portal or authorised admissions channel with verified supporting records.',
    details: [
      'Prepare academic transcripts, provisional/final degree certificates, English language scores (or university-accepted waiver evidence), statement of purpose, references, and passport identification copy.',
      'Some courses additionally request a CV, work-experience verification, portfolio, or admissions interview.',
    ],
  },
  {
    number: 3,
    title: 'Offer review and meeting conditions',
    scope: 'University Admissions',
    summary:
      'Review Conditional or Unconditional Offers carefully and satisfy every academic, English, and administrative requirement by the university deadline.',
    details: [
      'Check scholarship terms directly with the university; awards are subject to institutional eligibility and are never guaranteed unless confirmed in writing.',
      'If your postgraduate subject requires an Academic Technology Approval Scheme (ATAS) certificate, apply early using the CAH3 code on your offer.',
    ],
  },
  {
    number: 4,
    title: 'Deposit and CAS requirements',
    scope: 'Admissions & Visa',
    summary:
      'Complete institutional offer acceptance, tuition deposit (where required), and pre-CAS compliance checks to receive your Confirmation of Acceptance for Studies (CAS).',
    details: [
      'UKVI does not prescribe tuition deposit amounts; deposit figures, payment deadlines, pre-CAS interviews, and refund policies are governed by each university.',
      'Verify every detail on your issued CAS statement (course title, start/end dates, first-year tuition fee, and any tuition or accommodation fees already paid).',
    ],
  },
  {
    number: 5,
    title: 'Student visa preparation and application',
    scope: 'UK Student Visa (UKVI)',
    summary:
      'Meet UKVI immigration rules separately from university admissions, then submit your online Student visa application before travelling.',
    details: [
      'Unless exempt under UKVI rules, prepare compliant financial evidence covering unpaid first-year tuition plus required living funds held for at least 28 consecutive days ending within 31 days of application.',
      'Obtain an ATAS certificate (if required by subject/nationality) and an approved TB test certificate (if applying from a listed country) before applying online, paying the visa fee and Immigration Health Surcharge (IHS), and verifying identity via the UK Immigration: ID Check app or a Visa Application Centre (VAC).',
    ],
  },
  {
    number: 6,
    title: 'Visa decision and travel preparation',
    scope: 'UK Student Visa (UKVI)',
    summary:
      'Await your official UKVI decision before booking final travel and verify your digital eVisa status.',
    details: [
      'Do not travel to the UK while an entry clearance application is pending. Once granted, follow UKVI instructions to access your digital eVisa through your UKVI account and confirm your passport details match.',
      'Travel only on or after your permitted visa start date and carry your passport, eVisa access/share confirmation, decision notice, and CAS copy in hand luggage.',
    ],
  },
];

export const DOCUMENT_CHECKLIST_GROUPS: ChecklistGroup[] = [
  {
    id: 'university_application',
    title: 'University application',
    circumstanceNote:
      'Document lists and acceptable English waivers vary by university and programme level.',
    items: [
      {
        fieldName: 'doc_app_passport_copy',
        label: 'Valid passport bio-data page copy',
        status: 'Generally required',
        note: 'Matches applicant name and date of birth across all admission forms.',
      },
      {
        fieldName: 'doc_app_academic_records',
        label: 'Academic transcripts and school/degree certificates',
        status: 'Generally required',
        note: 'Include official certified translations if documents are not issued in English.',
      },
      {
        fieldName: 'doc_app_english_evidence',
        label: 'English language test report or accepted waiver evidence',
        status: 'Generally required',
        note: 'Test or Class 12 / prior qualification proof depends on university policy.',
      },
      {
        fieldName: 'doc_app_sop_references',
        label: 'Statement of purpose (SOP) and academic/employer references',
        status: 'Generally required',
        note: 'Number and type of references depend on the admitting university.',
      },
      {
        fieldName: 'doc_app_cv_portfolio',
        label: 'CV, work-experience letters, or creative/technical portfolio',
        status: 'If applicable',
        note: 'Requested for programmes requiring work history (e.g., MBA) or design/media portfolios.',
      },
    ],
  },
  {
    id: 'cas_preparation',
    title: 'CAS preparation',
    circumstanceNote:
      'CAS issuance conditions, deposits, and credibility checks are set by the sponsoring UK university.',
    items: [
      {
        fieldName: 'doc_cas_unconditional_offer',
        label: 'Accepted unconditional offer confirmation',
        status: 'Generally required',
        note: 'All academic and English conditions must be cleared before a CAS is issued.',
      },
      {
        fieldName: 'doc_cas_deposit_receipt',
        label: 'Tuition fee deposit receipt (and accommodation deposit, if paid)',
        status: 'If applicable',
        note: 'Required by most UK universities prior to CAS unless officially sponsored or exempt.',
      },
      {
        fieldName: 'doc_cas_credibility_checks',
        label: 'Pre-CAS financial screening & credibility interview clearance',
        status: 'If applicable',
        note: 'Requested by many sponsors before CAS release depending on university compliance checks.',
      },
      {
        fieldName: 'doc_cas_atas_certificate',
        label: 'Academic Technology Approval Scheme (ATAS) certificate',
        status: 'If applicable',
        note: 'Mandatory before CAS/visa when required by course CAH3 code and applicant nationality.',
      },
    ],
  },
  {
    id: 'uk_student_visa',
    title: 'UK Student visa',
    circumstanceNote:
      'Evidence depends on nationality exemptions, official sponsorship, age, and country of application under UKVI rules.',
    items: [
      {
        fieldName: 'doc_visa_passport',
        label: 'Current valid passport or travel document',
        status: 'Generally required',
        note: 'Used for online identity verification (UK Immigration: ID Check app or VAC biometrics).',
      },
      {
        fieldName: 'doc_visa_cas_statement',
        label: 'CAS reference number and university CAS statement',
        status: 'Generally required',
        note: 'Confirms licensed sponsor details, fees, and any tuition/accommodation already paid.',
      },
      {
        fieldName: 'doc_visa_financial_evidence',
        label: 'Financial evidence (28-day bank statements or official sponsorship letter)',
        status: 'If applicable',
        note: 'Check GOV.UK for current maintenance thresholds, parent consent rules, and differential evidence exemptions.',
      },
      {
        fieldName: 'doc_visa_tb_certificate',
        label: 'Approved clinic Tuberculosis (TB) test certificate',
        status: 'If applicable',
        note: 'Required when coming to the UK for over 6 months from a UKVI-listed country.',
      },
      {
        fieldName: 'doc_visa_translations_consent',
        label: 'Certified translations & under-18 parental consent + birth certificate',
        status: 'If applicable',
        note: 'Required for non-English/Welsh documents or applicants aged under 18.',
      },
    ],
  },
  {
    id: 'before_travel',
    title: 'Before travel',
    circumstanceNote:
      'Confirm digital immigration status and institutional arrival instructions before departing.',
    items: [
      {
        fieldName: 'doc_travel_evisa_ukvi',
        label: 'UKVI account & digital eVisa verification (matching passport)',
        status: 'Generally required',
        note: 'Verify your eVisa details and generate a share code if needed before boarding.',
      },
      {
        fieldName: 'doc_travel_cabin_pack',
        label: 'Decision notice, CAS copy, and key supporting copies in hand luggage',
        status: 'Generally required',
        note: 'Keep originals/printed copies accessible at UK border control alongside accommodation details.',
      },
      {
        fieldName: 'doc_travel_arrival_housing',
        label: 'Accommodation confirmation & university enrolment schedule',
        status: 'If applicable',
        note: 'Ensure travel dates fall within the permitted UKVI arrival window on your visa grant.',
      },
    ],
  },
];

