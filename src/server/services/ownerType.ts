import type { OwnerType } from '../types.js';

const INSTITUTIONAL_RE =
  /\b(reit|trust|trustee|pension|fund|capital|partners?\s+lp|l\.?p\.?\b|llp\b|holdings?\s+lp|investment|investments|asset\s+mgmt|asset\s+management|life\s+insurance|insurance\s+co|bank\b|national\s+association|n\.?a\.?\b|fannie|freddie|hud\b|gnma|cme\b|blackstone|brookfield|prologis|equinix|public\s+storage|extra\s+space|equity\s+residential|avalonbay|camden\s+property|mid[- ]america|greystar|lincoln\s+property|cb\s*re|cushman|jones\s+lang|jll\b|vanguard|fidelity|state\s+street|northern\s+trust|wellington|invesco|kkr\b|carlyle|apollo|ares\b|starwood|hines\b|related\s+cos|duke\s+realty|alexan|invitation\s+homes|american\s+homes\s+4|amh\b)\b/i;

const LLC_RE =
  /\b(l\.?l\.?c\.?|limited\s+liability\s+company|ltd\.?\s*co\.?|l\.?c\.?)\b/i;

const CORP_RE = /\b(inc\.?|corp\.?|corporation|company|co\.?|ltd\.?)\b/i;

const INDIVIDUAL_BLOCKLIST =
  /\b(llc|inc|corp|company|ltd|lp|llp|trust|reit|partners|holdings|properties|property|investments?|capital|fund|management|assoc|association|church|school|city\s+of|county\s+of|state\s+of|usa|united\s+states)\b/i;

/**
 * Classify parcel owner for outreach routing:
 * - individual → owner is the decision maker
 * - local_llc → OpenSOS officer lookup
 * - institutional → drop (out-of-state fund manager)
 */
export function classifyOwnerType(ownerName: string | null | undefined): OwnerType {
  const name = (ownerName ?? '').trim();
  if (!name) return 'unknown';

  if (INSTITUTIONAL_RE.test(name)) return 'institutional';

  // Explicit LLC / LP-style entities that aren't institutional keywords
  if (LLC_RE.test(name) || /\b(l\.?p\.?)\b/i.test(name)) {
    return 'local_llc';
  }

  // Corp names without institutional markers → treat as local entity (OpenSOS)
  if (CORP_RE.test(name)) return 'local_llc';

  // "LASTNAME FIRSTNAME" / "LAST, FIRST" style without entity tokens
  if (!INDIVIDUAL_BLOCKLIST.test(name)) {
    const parts = name.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^[A-Z.'-]+$/i.test(p))) {
      return 'individual';
    }
  }

  // Default: unknown entities with & or multiple tokens look like local cos
  if (/\b&\b|\band\b/i.test(name) && !INSTITUTIONAL_RE.test(name)) return 'local_llc';

  return 'unknown';
}
