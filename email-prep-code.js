// Get data from orchestrator (regardless of IF branch)
const orchestratorData = $('Code - Orchestrator').first().json;

const documents = orchestratorData.documents || [];
const headerHtml = orchestratorData.header_html;
const SECRET = orchestratorData.SECRET;

// Load display library again (small fetch)
const displayLibCode = await $fetch('https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js');
const displayLib = eval(displayLibCode);

// Load processor for action buttons
const processorCode = await $fetch('https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/workflow-processor-n8n.js');
const processor = eval(processorCode);

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
