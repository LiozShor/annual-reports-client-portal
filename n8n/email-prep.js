// Get data from orchestrator (regardless of IF branch)
const orchestratorData = $('Code - Orchestrator').first().json;

const documents = orchestratorData.documents || [];
const headerHtml = orchestratorData.header_html;
const SECRET = orchestratorData.SECRET;

// Load display library (small fetch)
const displayResp = await $helpers.httpRequest({url: 'https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js'});
const displayLibCode = typeof displayResp === 'string' ? displayResp : JSON.stringify(displayResp);
const displayLib = new Function(displayLibCode + '; return {formatDocumentName, groupDocumentsByCategory, separateClientAndSpouse, generateDocumentListHTML};')();

// Load processor for action buttons
const processorResp = await $helpers.httpRequest({url: 'https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/workflow-processor-n8n.js'});
const processorCode = typeof processorResp === 'string' ? processorResp : JSON.stringify(processorResp);
const processor = new Function(processorCode + '; return {buildActionButtonsHTML, htmlEscape};')();

// Generate document list HTML
const docsHtml = displayLib.generateDocumentListHTML(documents, {
  clientName: orchestratorData.client_name,
  spouseName: orchestratorData.spouse_name,
  language: 'he'
});

// Build action buttons
const buttonsHtml = processor.buildActionButtonsHTML({
  reportId: orchestratorData.report_record_id,
  clientEmail: orchestratorData.client_email,
  year: orchestratorData.year,
  spouseName: orchestratorData.spouse_name,
  clientName: orchestratorData.client_name
}, SECRET);

// Combine all parts
const finalEmailBody = headerHtml + docsHtml + buttonsHtml;

return [{
  json: {
    ...orchestratorData,
    email_body: finalEmailBody,
    email_subject: `התקבל שאלון שנתי: ${orchestratorData.client_name} - ${orchestratorData.year}`
  }
}];
