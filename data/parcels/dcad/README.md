# Dallas Central Appraisal District (DCAD) — commercial parcel extract

**sample:** false (real extract obtained)

## Source

- Portal: https://www.dallascad.org/DataProducts.aspx
- Product used: **2027 Data Files (Most Current Ownership)** — `DCAD2027_CURRENT.zip` (≈162.5 MB compressed)
- Download mechanism: `ViewPDFs.aspx?type=3&id=<UNC path>` (URL-encode the UNC)

Example direct URL:

```
https://www.dallascad.org/ViewPDFs.aspx?type=3&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5Cdata%20products%5CDCAD2027_CURRENT.zip
```

Related free products on the same page:

| Label | File | Size (approx) |
| --- | --- | --- |
| 2027 Current Ownership | `DCAD2027_CURRENT.zip` | 162 MB |
| 2026 Certified + supplements | `DCAD2026_CURRENT.ZIP` | 184 MB |
| 2026 Certified at certification | `DCAD2026_CERTIFIED_07232026.zip` | 184 MB |
| Mail 1 Appraisal Notice (RES+COM) | `MAIL1_APPRAISAL_NOTICE_DATA_2026.zip` | 14.5 MB (values/notice fields; no owner names) |
| GIS parcels | `GISDataProducts.aspx` → `PARCEL_GEOM.zip` | shapefiles |

## Real extract obtained

| File | Rows / notes | Size |
| --- | --- | --- |
| `DCAD2027_CURRENT.zip` | Full certified current ownership package | 162.5 MB |
| `commercial_parcels.csv` | **77,394** commercial accounts, canonical columns | 11.8 MB |
| `account_info_commercial.csv` | Raw `ACCOUNT_INFO` rows for COM accounts | 27.4 MB |
| `extract/COM_DETAIL.CSV` | Commercial taxable-object detail | 24.8 MB |
| `extract/MULTI_OWNER.CSV` | Multi-owner shares | 6.6 MB |
| `extract/TABLES AND FIELD NAMES.xlsx` | Official field dictionary | — |
| `MAIL1_APPRAISAL_NOTICE_DATA_2026.zip` | Notice/value roll (kept as alternate product) | 14.5 MB |
| `field_map.json` | Canonical column mapping | — |

## How to refresh annually

1. Open https://www.dallascad.org/DataProducts.aspx after July certification (and whenever “Most Current Ownership” is updated).
2. Prefer **Certified Data Files** for frozen values, or **Current Ownership** for the latest owner/situs snapshot.
3. Download via the `ViewPDFs.aspx?type=3&id=...` link (or re-run the same URL pattern with the new year filename, e.g. `DCAD2028_CURRENT.zip`).
4. Rebuild commercial extract:
   - Accounts present in `COM_DETAIL.CSV` (or `ACCOUNT_INFO.DIVISION_CD = COM`)
   - Join `ACCOUNT_INFO` (owner, mailing, situs) to `ACCOUNT_APPRL_YEAR` (values)
   - Map with `field_map.json` → overwrite `commercial_parcels.csv`

No login required. Files are large ZIPs; each archive includes field documentation.

## Field notes

Canonical columns in `commercial_parcels.csv`:

| Canonical | DCAD source |
| --- | --- |
| `county` | constant `Dallas` |
| `account_id` | `ACCOUNT_INFO.ACCOUNT_NUM` |
| `owner_name` | `OWNER_NAME1` (+ `OWNER_NAME2`) |
| `mailing_address` | `OWNER_ADDRESS_LINE1–4`, `OWNER_CITY`, `OWNER_STATE`, `OWNER_ZIPCODE` |
| `parcel_address` | `STREET_NUM` + `FULL_STREET_NAME` (+ bldg/unit) |
| `city` | `PROPERTY_CITY` |
| `zip` | `PROPERTY_ZIPCODE` (5-digit) |
| `assessed_value` | `ACCOUNT_APPRL_YEAR.TOT_VAL`, else **`PREV_MKT_VAL`** |
| `use_code` | `COM_DETAIL.BLDG_CLASS_DESC` (e.g. STORAGE WAREHOUSE, FREE STANDING RETAIL STORE, LAND ONLY) |
| `prop_type` | `Commercial` |

Important:

- The **2027 CURRENT** ownership file has `TOT_VAL` largely unset (pre-cert / in-progress values). This extract uses **`PREV_MKT_VAL`** (prior certified market) for ~74.9k of 77.4k rows when `TOT_VAL` is 0.
- For certified-year values, prefer `DCAD2026_CERTIFIED_*.zip` / `DCAD2026_CURRENT.ZIP` after July certification.
- `EXCLUDE_OWNER` / privacy flags exist in source; not filtered here.
- `MAIL1` notice file is tab-delimited values without owner/situs names — not used for the normalized commercial CSV.

## Repo packaging note

Full source rolls larger than GitHub’s 100 MB limit are kept locally / re-downloadable via the URLs above and listed in `data/parcels/.gitignore`. Normalized `commercial_parcels.csv` and field docs remain in-repo.
