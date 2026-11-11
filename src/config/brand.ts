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
  documentTitle: 'Course Shortlist',
  logoAssetPath: defaultEcchoLogoUrl,
  colors: {
    brandPrimary: '#3d8a3a',
    brandDark: '#265c24',
    brandHover: '#31722e',
    brandSoft: '#eef7ee',
    brandBorder: '#bdddbb',
    surfaceTint: '#f6faf6',
    surfaceAlt: '#ebf4eb',
    border: '#d5e3d4',
    borderStrong: '#b5cdb4',
    textPrimary: '#142317',
    textSecondary: '#3b513e',
    textMuted: '#586e5b',
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
