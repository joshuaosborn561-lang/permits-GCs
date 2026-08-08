# Tarrant Appraisal District (TAD) — commercial parcel extract

**sample:** false (real extract obtained)

## Source

- Portal: https://www.tad.org/resources/data-downloads
- Primary product: **Property Data — Commercial (Delimited)**  
  `https://www.tad.org/content/data-download/PropertyData(Delimited)_C.ZIP`
- Format: pipe (`|`) delimited text inside ZIP (not CSV)
- Layout docs (on portal): `/content/forms/PropertyData&PropertyLocationLayouts.pdf` (may be Cloudflare-challenged from some clients)

### Documented download URLs (freely linked; no login)

| Product | URL | Obtained? | Size |
| --- | --- | --- | --- |
| PropertyData Commercial (current delimited) | `https://www.tad.org/content/data-download/PropertyData(Delimited)_C.ZIP` | yes | 5.1 MB |
| PropertyData Full Set (current delimited) | `https://www.tad.org/content/data-download/PropertyData(Delimited).ZIP` | yes | 93.2 MB |
| PropertyData Full Set 2025 Certified | `https://www.tad.org/content/data-download/PropertyData_2025(Certified).ZIP` | yes | 78.9 MB |
| PropertyData Commercial 2025 Certified | `https://www.tad.org/content/data-download/PropertyData_C_2025(Certified).ZIP` | intermittent **403** (Cloudflare) | — |
| Supplemental Commercial 2025 | `https://www.tad.org/content/data-download/PropertyDataSupplemental_C_2025(Certified).ZIP` | yes | 5.5 MB |
| PropertyLocation (Delimited) | `https://www.tad.org/content/data-download/PropertyLocation(Delimited).ZIP` | **403** from this environment | — |
| True Prodigy Extract (full) | Linked from portal; commercial slice often “Coming Soon” | not required | large |
| Commercial sales / E&U / caps (comps) | `/content/data-download/2026Comm*.zip` etc. | not ownership rolls | varies |

Note: Site is behind Cloudflare. Browser session cookies usually work for PropertyData ZIPs; some paths (`PropertyLocation*`, occasional `_C_YYYY` certified) return challenge HTML.

## Real extract obtained

| File | Rows / notes | Size |
| --- | --- | --- |
| `PropertyData_Delimited_C.zip` | Source commercial roll | 5.1 MB |
| `extract_c/PropertyData(Delimited)_C.txt` | Unzipped pipe file (Appraisal Year **2026**) | 20.4 MB |
| `commercial_parcels.csv` | **59,007** commercial accounts, canonical columns | 7.4 MB |
| `PropertyDataSupplemental_C_2025.zip` | Used to fill `city` via `SitusCity` | 5.5 MB |
| `PropertyData_Delimited.zip` | Full county PropertyData (all types) | 93.2 MB |
| `PropertyData_2025_Certified.zip` | 2025 certified full set | 78.9 MB |
| `field_map.json` | Canonical column mapping | — |

## How to refresh annually

1. Open https://www.tad.org/resources/data-downloads after certification / when “Property Data” shows the new tax year (2026 currently notes “Revised TBD” for some slices).
2. Download `PropertyData(Delimited)_C.ZIP` (commercial) or the full `PropertyData(Delimited).ZIP`.
3. Optionally download `PropertyDataSupplemental_C_YYYY(Certified).ZIP` for situs city / lat-long / land use extras (UTF-16 LE).
4. Re-normalize with `field_map.json` → overwrite `commercial_parcels.csv`.
5. For frozen certified snapshots, use `PropertyData_C_YYYY(Certified).ZIP` / `PropertyData_YYYY(Certified).ZIP` when available.

No account/login required for these Property Data ZIPs. Commercial evidence PDFs on the owner dashboard are separate and do require login.

## Field notes

Canonical columns in `commercial_parcels.csv`:

| Canonical | TAD source |
| --- | --- |
| `county` | constant `Tarrant` |
| `account_id` | `Account_Num` |
| `owner_name` | `Owner_Name` |
| `mailing_address` | `Owner_Address` + `Owner_CityState` + `Owner_Zip` |
| `parcel_address` | `Situs_Address` |
| `city` | `PropertyDataSupplemental_C_2025.SitusCity` joined on account (≈58.3k filled) |
| `zip` | **not in commercial PropertyData file**; `PropertyLocation` download was blocked here — left blank |
| `assessed_value` | `Appraised_Value` (fallback `Total_Value`) |
| `use_code` | `Property_Class` (e.g. `C1C`) / `State_Use_Code` |
| `prop_type` | `Commercial` |

Important:

- Delimiter is **`|`**, not comma.
- Supplemental commercial file is **UTF-16 LE** (BOM `FF FE`).
- `City` / `County` / `School` columns in PropertyData are **taxing-unit codes**, not situs city names.
- Situs ZIP would normally come from PropertyLocation; until that file is obtainable, `zip` remains empty in the normalized commercial CSV.

## Repo packaging note

Full source rolls larger than GitHub’s 100 MB limit are kept locally / re-downloadable via the URLs above and listed in `data/parcels/.gitignore`. Normalized `commercial_parcels.csv` and field docs remain in-repo.
