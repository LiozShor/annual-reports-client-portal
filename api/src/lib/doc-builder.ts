/**
 * doc-builder.ts
 *
 * Extracts the "Build Response" logic from the n8n workflow [API] Get Client Documents
 * into clean, reusable pure functions.
 *
 * Used by:
 *   - get-client-documents  (Phase 4a)
 *   - get-pending-classifications (Phase 4b)
 */

import type { AirtableRecord } from './airtable';

// ---------------------------------------------------------------------------
// Raw field types
// ---------------------------------------------------------------------------

export interface DocFields {
  id?: string;             // from AirtableRecord.id (merged by caller)
  type?: string;           // template_id e.g. 'T101'
  status?: string;         // Received | Required_Missing | Requires_Fix | Waived | Removed
  person?: string;         // client | spouse
  category?: string;       // category_id
  issuer_name?: string;    // may contain HTML bold tags, e.g. <b>מיטב דש</b>
  issuer_name_en?: string;
  file_url?: string;
  onedrive_item_id?: string;
  file_hash?: string;
  bookkeepers_notes?: string;
  fix_reason_client?: string;
}

export interface CategoryInfo {
  emoji: string;
  name_he: string;
  name_en: string;
  sort_order: number;
}

export interface TemplateInfo {
  name_he: string;
  name_en: string;
  short_name_he?: string;
  category?: string;
  scope?: string;      // CLIENT | SPOUSE
  variables?: string;  // comma-separated variable names
  help_he?: string;
  help_en?: string;
}

export interface CompanyLink {
  name_he?: string;
  name_en?: string;
  url: string;
  aliases?: string; // slash or newline separated
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DocCategory {
  category_id: string;
  emoji: string;
  name_he: string;
  name_en: string;
  sort_order: number;
  docs: Record<string, unknown>[];
}

export interface DocGroup {
  person: string;
  person_label_he: string;
  person_label_en?: string;
  categories: DocCategory[];
}

// ---------------------------------------------------------------------------
// Report context (subset of what callers pass in)
// ---------------------------------------------------------------------------

export interface ReportContext {
  client_name: string;
  spouse_name: string;
  year: string;
  source_language?: string;
}

// ---------------------------------------------------------------------------
// 1. buildCategoryMap
// ---------------------------------------------------------------------------

/**
 * Build a Map from category_id → CategoryInfo from Airtable category records.
 */
export function buildCategoryMap(
  categories: AirtableRecord[]
): Map<string, CategoryInfo> {
  const map = new Map<string, CategoryInfo>();

  for (const record of categories) {
    const f = record.fields as Record<string, unknown>;
    const categoryId = f['category_id'] as string | undefined;
    if (!categoryId) continue;

    map.set(categoryId, {
      emoji: (f['emoji'] as string) ?? '📋',
      name_he: (f['name_he'] as string) ?? categoryId,
      name_en: (f['name_en'] as string) ?? categoryId,
      sort_order: typeof f['sort_order'] === 'number' ? (f['sort_order'] as number) : 99,
    });
  }

  return map;
}

// ---------------------------------------------------------------------------
// 2. buildTemplateMap
// ---------------------------------------------------------------------------

/**
 * Build a Map from template_id → TemplateInfo from Airtable template records.
 */
export function buildTemplateMap(
  templates: AirtableRecord[]
): Map<string, TemplateInfo> {
  const map = new Map<string, TemplateInfo>();

  for (const record of templates) {
    const f = record.fields as Record<string, unknown>;
    const templateId = f['template_id'] as string | undefined;
    if (!templateId) continue;

    map.set(templateId, {
      name_he: (f['name_he'] as string) ?? templateId,
      name_en: (f['name_en'] as string) ?? templateId,
      short_name_he: f['short_name_he'] as string | undefined,
      category: f['category'] as string | undefined,
      scope: f['scope'] as string | undefined,
      variables: f['variables'] as string | undefined,
      help_he: f['help_he'] as string | undefined,
      help_en: f['help_en'] as string | undefined,
    });
  }

  return map;
}

// ---------------------------------------------------------------------------
// 3. buildCompanyLinkMap
// ---------------------------------------------------------------------------

/**
 * Build a Map from company name → URL from Airtable company_links records.
 * Indexes by name_he, name_en, and each alias (split by / or newline).
 */
export function buildCompanyLinkMap(
  companyLinks: AirtableRecord[]
): Map<string, string> {
  const map = new Map<string, string>();

  for (const record of companyLinks) {
    const f = record.fields as Record<string, unknown>;
    const url = f['url'] as string | undefined;
    if (!url) continue;

    const addKey = (key: string | undefined) => {
      if (key && key.trim()) map.set(key.trim(), url);
    };

    addKey(f['name_he'] as string | undefined);
    addKey(f['name_en'] as string | undefined);

    const aliases = f['aliases'] as string | undefined;
    if (aliases) {
      // Split by slash or newline
      aliases.split(/[/\n]/).forEach((alias) => addKey(alias));
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// 4. resolveHelpText
// ---------------------------------------------------------------------------

/**
 * Resolve template placeholders in a help text string.
 *
 * Placeholders:
 *   {year}         → report year
 *   {company_name} → bold part of docTitle (text between <b> and </b>), or full docTitle
 *   {company_url}  → URL from companyLinks map; removed if not found
 */
export function resolveHelpText(
  helpTemplate: string,
  year: string,
  docTitle: string,
  companyLinks: Map<string, string>
): string {
  let result = helpTemplate;

  // Replace {year} and {year_plus_1}
  result = result.replace(/\{year\}/g, year);
  result = result.replace(/\{year_plus_1\}/g, String(parseInt(year) + 1));

  // Find company by matching company link names against doc title (handles nested <b> tags)
  const cleanTitle = docTitle.replace(/<\/?b>/gi, '').replace(/["״]/g, '');
  const cleanTitleLower = cleanTitle.toLowerCase();
  let companyName = '';
  let companyUrl = '';
  for (const [name, url] of companyLinks) {
    if (cleanTitleLower.includes(name.toLowerCase()) && name.length > companyName.length) {
      companyName = name;
      companyUrl = url;
    }
  }
  // Fallback: extract from last bold segment (strip nested tags)
  if (!companyName) {
    const boldMatches = [...docTitle.matchAll(/<b>(.*?)<\/b>/gi)]
      .map(m => m[1].replace(/<\/?b>/gi, '').replace(/["״]/g, '').trim());
    companyName = boldMatches[boldMatches.length - 1] || '';
  }

  // Replace {company_name}
  result = result.replace(/\{company_name\}/g, companyName);

  // Replace {company_url}
  if (companyUrl) {
    result = result.replace(/\{company_url\}/g, companyUrl);
  } else {
    // Strip entire <a> tag when no URL, keep text content
    result = result.replace(/<a\s+href="\{company_url\}"[^>]*>(.*?)<\/a>/gi, '$1');
    result = result.replace(/\{company_url\}/g, '');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags to get plain text (for sorting purposes only). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

const GENERAL_CATEGORY_INFO: CategoryInfo = {
  emoji: '📋',
  name_he: 'כללי',
  name_en: 'General',
  sort_order: 99,
};

// ---------------------------------------------------------------------------
// 5. groupDocsByPerson
// ---------------------------------------------------------------------------

/**
 * Group documents by person → category, resolve display names and help text.
 * Returns client group first, then spouse.
 */
export function groupDocsByPerson(
  docs: DocFields[],
  report: ReportContext,
  categoryMap: Map<string, CategoryInfo>,
  templateMap: Map<string, TemplateInfo>,
  companyLinks: Map<string, string>
): DocGroup[] {
  // Intermediate structure: person → category_id → docs
  const personMap = new Map<string, Map<string, DocFields[]>>();

  const getPersonBucket = (person: string): Map<string, DocFields[]> => {
    if (!personMap.has(person)) personMap.set(person, new Map());
    return personMap.get(person)!;
  };

  for (const doc of docs) {
    const person = doc.person ?? 'client';
    const categoryId = doc.category ?? 'general';
    const bucket = getPersonBucket(person);
    if (!bucket.has(categoryId)) bucket.set(categoryId, []);
    bucket.get(categoryId)!.push(doc);
  }

  const buildDocEntry = (doc: DocFields): Record<string, unknown> => {
    const tmpl = doc.type ? templateMap.get(doc.type) : undefined;

    // Display names: issuer_name if present, otherwise template name
    const name_he = doc.issuer_name ?? tmpl?.name_he ?? doc.type ?? '';
    const name_en = doc.issuer_name_en ?? tmpl?.name_en ?? doc.type ?? '';

    // Resolve help text
    let help_he: string | undefined;
    let help_en: string | undefined;
    if (tmpl?.help_he) {
      help_he = resolveHelpText(tmpl.help_he, report.year, name_he, companyLinks);
    }
    if (tmpl?.help_en) {
      help_en = resolveHelpText(tmpl.help_en, report.year, name_en, companyLinks);
    }

    return {
      ...doc,
      name_he,
      name_en,
      ...(help_he !== undefined ? { help_he } : {}),
      ...(help_en !== undefined ? { help_en } : {}),
    };
  };

  const buildDocGroup = (person: string, catMap: Map<string, DocFields[]>): DocGroup => {
    const isSpouse = person === 'spouse';
    const personName = isSpouse ? report.spouse_name : report.client_name;

    const categories: DocCategory[] = [];

    for (const [categoryId, categoryDocs] of catMap) {
      const catInfo = categoryMap.get(categoryId) ?? GENERAL_CATEGORY_INFO;

      // Sort docs: by type then by display name
      const sortedDocs = categoryDocs
        .map(buildDocEntry)
        .sort((a, b) => {
          const typeA = (a['type'] as string) ?? '';
          const typeB = (b['type'] as string) ?? '';
          if (typeA !== typeB) return typeA.localeCompare(typeB);
          const nameA = stripHtml((a['name_he'] as string) ?? '');
          const nameB = stripHtml((b['name_he'] as string) ?? '');
          return nameA.localeCompare(nameB, 'he');
        });

      categories.push({
        category_id: categoryId,
        emoji: catInfo.emoji,
        name_he: catInfo.name_he,
        name_en: catInfo.name_en,
        sort_order: catInfo.sort_order,
        docs: sortedDocs,
      });
    }

    // Sort categories by sort_order
    categories.sort((a, b) => a.sort_order - b.sort_order);

    return {
      person,
      person_label_he: `מסמכים של ${personName}`,
      person_label_en: `Documents for ${personName}`,
      categories,
    };
  };

  // Build groups — client first, then spouse
  const groups: DocGroup[] = [];

  const clientCats = personMap.get('client');
  if (clientCats) groups.push(buildDocGroup('client', clientCats));

  const spouseCats = personMap.get('spouse');
  if (spouseCats) groups.push(buildDocGroup('spouse', spouseCats));

  // Any other person values
  for (const [person, cats] of personMap) {
    if (person !== 'client' && person !== 'spouse') {
      groups.push(buildDocGroup(person, cats));
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// 6. filterForClientMode
// ---------------------------------------------------------------------------

const CLIENT_SAFE_FIELDS = new Set([
  'name_he',
  'name_en',
  'type',
  'status',
  'fix_reason_client',
  'issuer_name',
  'issuer_name_en',
  'help_he',
  'help_en',
]);

const CLIENT_EXCLUDED_STATUSES = new Set(['Waived', 'Removed']);

/**
 * Deep-clone groups and strip internal fields + excluded statuses for client view.
 */
export function filterForClientMode(groups: DocGroup[]): DocGroup[] {
  const result: DocGroup[] = [];

  for (const group of groups) {
    const filteredCategories: DocCategory[] = [];

    for (const cat of group.categories) {
      const filteredDocs = cat.docs
        .filter((doc) => {
          const status = doc['status'] as string | undefined;
          return !status || !CLIENT_EXCLUDED_STATUSES.has(status);
        })
        .map((doc) => {
          const safe: Record<string, unknown> = {};
          for (const key of CLIENT_SAFE_FIELDS) {
            if (key in doc) safe[key] = doc[key];
          }
          return safe;
        });

      if (filteredDocs.length > 0) {
        filteredCategories.push({ ...cat, docs: filteredDocs });
      }
    }

    if (filteredCategories.length > 0) {
      result.push({ ...group, categories: filteredCategories });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 7. formatForOfficeMode
// ---------------------------------------------------------------------------

/**
 * Format groups for office mode: Hebrew-only field names matching frontend expectations.
 * Renames: person_label_he → person_label, name_he → name (categories + docs).
 * Drops: person_label_en, name_en (internal use only).
 */
export function formatForOfficeMode(groups: DocGroup[]): Record<string, unknown>[] {
  return groups.map((group) => ({
    person: group.person,
    person_label: group.person_label_he,
    categories: group.categories.map((cat) => ({
      ...cat,
      name: cat.name_he,
      docs: cat.docs.map((doc) => {
        const { name_he, name_en: _enDrop, ...rest } = doc as Record<string, unknown>;
        return { ...rest, name: name_he };
      }),
    })),
  }));
}
