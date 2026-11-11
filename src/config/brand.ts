import defaultEcchoLogoUrl from '../assets/eccho-logo.png?url';

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
    brandPrimary: string;
    brandDark: string;
    brandHover: string;
    brandSoft: string;
    brandBorder: string;
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
  documentTitle: 'Personalised Course Shortlist',
  logoAssetPath: defaultEcchoLogoUrl,
  colors: {
    brandPrimary: '#3d8a3a',
    brandDark: '#265c24',
    brandHover: '#30702e',
    brandSoft: '#eef4ed',
    brandBorder: '#c5d8c3',
    surfaceTint: '#f6f9f5',
    surfaceAlt: '#edf3ec',
    border: '#dce4db',
    borderStrong: '#c2cfc0',
    textPrimary: '#181e1a',
    textSecondary: '#475249',
    textMuted: '#68746a',
    white: '#FFFFFF',
  },
  contact: {
    email: '',
    phone: '',
    website: '',
    address: '',
  },
  footerNote:
    'Fees, scholarships, dates and entry requirements are subject to change. Confirm with your Counsellor from Eccho Overseas.',
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
