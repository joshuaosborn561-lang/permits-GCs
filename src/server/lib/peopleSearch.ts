export interface PeopleSearchPack {
  search_name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  street: string | null;
  google_query: string;
  google_url: string;
  fastpeoplesearch_url: string;
  truepeoplesearch_url: string;
  thatsthem_url: string;
  instructions: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleName(s: string): string {
  return s
    .replace(/[^A-Za-z0-9 .'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPeopleSearchPack(opts: {
  name: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  street?: string | null;
}): PeopleSearchPack | null {
  const name = titleName(opts.name || '');
  if (name.split(' ').length < 2) return null;
  const city = (opts.city || '').trim();
  const state = (opts.state || 'TX').trim() || 'TX';
  const zip = (opts.zip || '').trim();
  const street = (opts.street || '').trim();
  const place = [city, state].filter(Boolean).join(' ');
  const queryParts = [`"${name}"`];
  if (street) queryParts.push(`"${street}"`);
  else if (zip) queryParts.push(zip);
  else if (place) queryParts.push(place);
  const googleQuery = queryParts.join(' ');
  const nameSlug = slug(name);
  const citySlug = slug([city, state].filter(Boolean).join(' '));
  const loc = [city, state, zip].filter(Boolean).join(' ');
  return {
    search_name: name,
    city: city || null,
    state: state || null,
    zip: zip || null,
    street: street || null,
    google_query: googleQuery,
    google_url: `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`,
    fastpeoplesearch_url: citySlug
      ? `https://www.fastpeoplesearch.com/name/${nameSlug}_${citySlug}`
      : `https://www.fastpeoplesearch.com/name/${nameSlug}`,
    truepeoplesearch_url: `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(name)}${
      loc ? `&citystatezip=${encodeURIComponent(loc)}` : ''
    }`,
    thatsthem_url: `https://thatsthem.com/name/${name.replace(/\s+/g, '-')}/${state || 'Texas'}`,
    instructions:
      'Open Google or FastPeopleSearch/TruePeopleSearch. Prefer a result whose street/city matches the officer address. Take the wireless/cell number only. Then record_owner_cell. Do not dump every hit into chat.',
  };
}
