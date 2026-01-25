// ORCHESTRATOR - Fetches libraries and processes everything
// All business logic is in GitHub libraries (SSOT)

const tallyData = $input.first().json.body;
const SECRET = 'MOSHE_1710';

// Fetch all SSOT libraries from GitHub (parallel)
const [mappingResp, displayResp, processorResp] = await Promise.all([
  $helpers.httpRequest({url: 'https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/questionnaire-mapping.json'}),
  $helpers.httpRequest({url: 'https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js'}),
  $helpers.httpRequest({url: 'https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/workflow-processor-n8n.js'})
]);

const mappingData = typeof mappingResp === 'string' ? JSON.parse(mappingResp) : mappingResp;
const displayLibCode = typeof displayResp === 'string' ? displayResp : JSON.stringify(displayResp);
const processorCode = typeof processorResp === 'string' ? processorResp : JSON.stringify(processorResp);

// Load libraries
const displayLib = eval(displayLibCode);
const processor = eval(processorCode);

// Extract system fields
const systemFields = processor.extractSystemFields(tallyData);

// Build questionnaire answers table HTML
const answersTableHtml = processor.buildAnswersTableHTML(tallyData, systemFields.form_language);

const headerHtml = `
<div style="font-family: Arial, sans-serif; direction: rtl; text-align: right;">
  <h3 style="margin:0 0 8px 0;">התקבלו תשובות חדשות לשאלון (${systemFields.form_language === 'en' ? 'אנגלית' : 'עברית'})</h3>
  <div style="margin:0 0 12px 0; color:#555;">
    <div><strong>טופס:</strong> ${processor.htmlEscape(systemFields.formName)}</div>
    <div><strong>תאריך:</strong> ${processor.htmlEscape(systemFields.createdAt)}</div>
    <div><strong>לקוח:</strong> ${processor.htmlEscape(systemFields.display_name)}</div>
    <div><strong>שנה:</strong> ${processor.htmlEscape(systemFields.year)}</div>
    <div><strong>אימייל:</strong> ${processor.htmlEscape(systemFields.client_email)}</div>
  </div>
  <table style="border-collapse: collapse; width:100%; direction: rtl;">${answersTableHtml}</table>
</div>`;

// Process mappings to create documents
const documents = processor.processAllMappings(tallyData, mappingData, systemFields);

// Deduplicate
const uniqueDocs = processor.deduplicateDocuments(documents);

// Return everything for next nodes
return [{
  json: {
    ...systemFields,
    documents: uniqueDocs,
    doc_count: uniqueDocs.length,
    header_html: headerHtml,
    SECRET: SECRET
  }
}];
