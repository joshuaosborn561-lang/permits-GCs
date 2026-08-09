/** Owner-type classification for commercial parcels (parameter-free heuristics). */

export type OwnerType =
  | "local_llc"
  | "individual"
  | "institutional"
  | "municipal"
  | "unknown";

const LLC_RE =
  /\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|LTD\.?|LP|L\.P\.|LLP|COMPANY|CO\.|TRUST|HOLDINGS?|PROPERTIES|PARTNERS|PARTNERSHIP)\b/i;

const INSTITUTIONAL_RE =
  /\b(BANK|CREDIT UNION|REIT|FUND|CAPITAL|INVESTMENT|ASSET|MANAGEMENT|INSURANCE|PENSION|FOUNDATION)\b/i;

/** Cities, counties, schools, housing authorities, churches, transit, universities. */
export const MUNICIPAL_RE =
  /\b(CITY OF|COUNTY OF|TOWN OF|VILLAGE OF|STATE OF|SCHOOL DISTRICT|\bISD\b|HOUSING AUTHORITY|UNIVERSITY|COLLEGE|CHURCH|TRANSIT AUTHORITY|MUNICIPAL|METROPOLITAN|PUBLIC LIBRARY|FIRE DISTRICT|WATER DISTRICT|UTILITY DISTRICT)\b/i;

/**
 * Classify a single owner name. Municipal is checked before institutional so
 * "CITY OF DALLAS" is not swallowed by generic corp heuristics.
 */
export function classifyOwnerType(ownerName: string | null | undefined): OwnerType {
  const name = (ownerName ?? "").trim();
  if (!name) return "unknown";
  if (MUNICIPAL_RE.test(name)) return "municipal";
  if (LLC_RE.test(name)) return "local_llc";
  if (INSTITUTIONAL_RE.test(name)) return "institutional";
  // Heuristic: no org tokens and looks like a person name (2–4 alphabetic tokens)
  if (/^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(name) && !LLC_RE.test(name)) {
    return "individual";
  }
  return "unknown";
}
