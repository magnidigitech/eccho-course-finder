export interface BrandContactConfig {
  email: string;
  phone: string;
  website: string;
  address: string;
}

export interface BrandConfig {
  brandName: string;
  wordmark: string;
  documentTitle: string;
  logoAssetPath: string | null;
  colors: {
    navyPrimary: string;
    navySecondary: string;
    orangeAccent: string;
    orangeSoft: string;
    orangeBorder: string;
    surfaceTint: string;
    surfaceAlt: string;
    border: string;
    borderStrong: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    white: string;
  };
  contact: BrandContactConfig;
  footerNote: string;
}

export const BRAND_CONFIG: BrandConfig = {
  brandName: 'Eccho Overseas',
  wordmark: 'ECCHO OVERSEAS',
  documentTitle: 'Course Shortlist',
  logoAssetPath: null,
  colors: {
    navyPrimary: '#0F2744',
    navySecondary: '#1B3B66',
    orangeAccent: '#D95D18',
    orangeSoft: '#FFF6F0',
    orangeBorder: '#F2C7AE',
    surfaceTint: '#F6F8FB',
    surfaceAlt: '#EEF3F9',
    border: '#DCE3ED',
    borderStrong: '#C5D0DF',
    textPrimary: '#112236',
    textSecondary: '#3E5066',
    textMuted: '#607287',
    white: '#FFFFFF',
  },
  contact: {
    email: '',
    phone: '',
    website: '',
    address: '',
  },
  footerNote:
    'Fees, scholarships and entry requirements are subject to change. Confirm details with the university.',
};

export interface ContactEntry {
  label: string;
  value: string;
}

/** Returns only non-empty contact entries so empty fields are strictly omitted. */
export function getNonEmptyContactEntries(
  contact: BrandContactConfig = BRAND_CONFIG.contact,
): ContactEntry[] {
  const candidates: ContactEntry[] = [
    { label: 'Email', value: contact.email.trim() },
    { label: 'Phone', value: contact.phone.trim() },
    { label: 'Website', value: contact.website.trim() },
    { label: 'Address', value: contact.address.trim() },
  ];
  return candidates.filter((entry) => entry.value.length > 0);
}

