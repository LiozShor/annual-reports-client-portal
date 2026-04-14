/* ===========================================
   CHATBOT — AI Chat Agent for Admin Panel
   Floating chat widget with tool-use approval flow.
   Depends on: shared/constants.js, shared/endpoints.js,
               assets/js/resilient-fetch.js, script.js
   =========================================== */

(function () {
    'use strict';

    // ==================== 1. CONFIG ====================

    const CHAT_ENDPOINT = ENDPOINTS.ADMIN_CHAT || (typeof CF_BASE !== 'undefined'
        ? CF_BASE + '/admin-chat'
        : 'https://annual-reports-api.liozshor1.workers.dev/webhook/admin-chat');

    const MAX_HISTORY = 16;
    const MAX_ITERATIONS = 3;
    const BATCH_THRESHOLD = 10;
    const CHAT_TIMEOUT = 30000; // 30s — AI responses can be slow

    // ==================== 2. STATE ====================

    let messages = [];
    let isOpen = sessionStorage.getItem('chatbot_open') === 'true';
    let isLoading = false;
    let pendingApprovalReject = null; // reject fn for in-flight approval Promise

    // ==================== 3. TOOL DEFINITIONS ====================

    const TOOL_DEFS = [
        {
            name: 'move_to_stage',
            description: 'העבר תיק לשלב אחר בצינור.',
            input_schema: {
                type: 'object',
                properties: {
                    report_id: { type: 'string', description: 'Airtable record ID' },
                    new_stage: {
                        type: 'string',
                        enum: ['Send_Questionnaire', 'Waiting_For_Answers', 'Pending_Approval', 'Collecting_Docs', 'Review', 'Moshe_Review', 'Before_Signing', 'Completed']
                    },
                    reason: { type: 'string', description: 'Reason for stage change' }
                },
                required: ['report_id', 'new_stage', 'reason']
            }
        },
        {
            name: 'send_reminder',
            description: 'שלח תזכורת ידנית ללקוח.',
            input_schema: {
                type: 'object',
                properties: { report_id: { type: 'string' } },
                required: ['report_id']
            }
        },
        {
            name: 'add_note',
            description: 'הוסף הערה פנימית לתיק.',
            input_schema: {
                type: 'object',
                properties: {
                    report_id: { type: 'string' },
                    note_text: { type: 'string' }
                },
                required: ['report_id', 'note_text']
            }
        },
        {
            name: 'suppress_reminder',
            description: 'הפעל או בטל השהיית תזכורות.',
            input_schema: {
                type: 'object',
                properties: {
                    report_id: { type: 'string' },
                    suppress: { type: 'boolean' }
                },
                required: ['report_id', 'suppress']
            }
        },
        {
            name: 'send_questionnaire',
            description: 'שלח שאלון ללקוח באימייל.',
            input_schema: {
                type: 'object',
                properties: {
                    report_id: { type: 'string' }
                },
                required: ['report_id']
            }
        },
        {
            name: 'get_client_documents',
            description: 'שלוף רשימת מסמכים של לקוח.',
            input_schema: {
                type: 'object',
                properties: {
                    report_id: { type: 'string' }
                },
                required: ['report_id']
            }
        },
        {
            name: 'change_reminder_date',
            description: 'שנה את תאריך התזכורת הבאה של לקוח.',
            input_schema: {
                type: 'object',
                properties: {
                    report_id: { type: 'string' },
                    new_date: { type: 'string', description: 'תאריך חדש בפורמט YYYY-MM-DD' }
                },
                required: ['report_id', 'new_date']
            }
        },
        {
            name: 'send_feedback',
            description: 'שלח הודעה/משוב לצוות הפיתוח.',
            input_schema: {
                type: 'object',
                properties: {
                    subject: { type: 'string' },
                    message: { type: 'string' }
                },
                required: ['subject', 'message']
            }
        }
    ];

    // Read-only tools that don't require user approval
    const AUTO_APPROVE_TOOLS = new Set(['get_client_documents']);

    // ==================== 4. buildChatContext() ====================

    function buildChatContext() {
        const ctx = { _today: new Date().toISOString().slice(0, 10), _not_loaded: [] };

        // Clients
        if (typeof dashboardLoaded !== 'undefined' && dashboardLoaded && Array.isArray(clientsData)) {
            ctx.clients = clientsData.map(c => ({
                name: c.name,
                report_id: c.report_id,
                stage: c.stage,
                year: c.year,
                docs_received: c.docs_received,
                docs_total: c.docs_total,
                is_active: c.is_active,
                notes: c.notes
            }));
            const activeClients = clientsData.filter(c => c.is_active !== false);
            const stageDist = {};
            activeClients.forEach(c => {
                const label = STAGE_LABELS[c.stage] || c.stage;
                stageDist[label] = (stageDist[label] || 0) + 1;
            });
            ctx._stats = {
                total_clients: clientsData.length,
                active_clients: activeClients.length,
                stage_distribution: stageDist
            };
        } else {
            ctx._not_loaded.push('clients');
        }

        // Review queue
        if (Array.isArray(reviewQueueData) && reviewQueueData.length > 0) {
            ctx.review_queue = reviewQueueData.map(r => ({
                report_id: r.report_id,
                docs_completed_at: r.docs_completed_at
            }));
        }

        // Reminders
        if (typeof reminderLoaded !== 'undefined' && reminderLoaded && Array.isArray(remindersData)) {
            ctx.reminders = remindersData.map(r => ({
                report_id: r.report_id,
                reminder_next_date: r.reminder_next_date,
                reminder_count: r.reminder_count,
                reminder_max: r.reminder_max,
                reminder_suppress: r.reminder_suppress
            }));
        } else {
            ctx._not_loaded.push('reminders');
        }

        // AI Classifications
        if (typeof aiReviewLoaded !== 'undefined' && aiReviewLoaded && Array.isArray(aiClassificationsData)) {
            ctx.ai_classifications = aiClassificationsData.map(a => ({
                client_name: a.client_name,
                attachment_name: a.attachment_name,
                matched_doc_name: a.matched_doc_name,
                review_status: a.review_status,
                confidence_score: a.confidence_score
            }));
        } else {
            ctx._not_loaded.push('ai_classifications');
        }

        // Questionnaires
        if (typeof questionnaireLoaded !== 'undefined' && questionnaireLoaded && Array.isArray(questionnairesData)) {
            ctx.questionnaires = questionnairesData.map(q => ({
                name: q.client_info?.name,
                submission_date: q.client_info?.submission_date,
                report_record_id: q.report_record_id
            }));
        } else {
            ctx._not_loaded.push('questionnaires');
        }

        if (ctx._not_loaded.length === 0) delete ctx._not_loaded;
        return ctx;
    }

    // ==================== 5. sendMessage() ====================

    async function sendMessage(text) {
        if (!text.trim() || isLoading) return;

        // Add user message to messages array
        messages.push({ role: 'user', content: text });

        // Render user message in UI
        renderMessage('user', text);
        clearSuggestionChips();
        setLoading(true);

        try {
            await runAgentLoop();
        } catch (err) {
            if (err.message === 'cancelled') {
                // User closed panel while approval was pending — silent
                return;
            }
            console.error('Chat error:', err);
            renderMessage('error', 'שגיאה בתקשורת עם השרת. נסה שוב.');
        } finally {
            setLoading(false);
        }
    }

    async function runAgentLoop() {
        // Build context once — refreshed data is loaded silently if tools execute
        const context = buildChatContext();

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            // Trim messages to sliding window
            trimMessages();

            const payload = {
                token: authToken,
                messages: messages,
                tools: TOOL_DEFS,
                context: JSON.stringify(context)
            };

            const response = await fetchWithTimeout(CHAT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, CHAT_TIMEOUT);

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            const data = await response.json();

            // The response has content[] array
            const contentBlocks = data.content || [];
            const stopReason = data.stop_reason || 'end_turn';

            // Store the assistant message with full content blocks
            const assistantMsg = { role: 'assistant', content: contentBlocks };
            messages.push(assistantMsg);

            // Separate text blocks and tool_use blocks
            const textBlocks = contentBlocks.filter(b => b.type === 'text');
            const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');

            // Render text blocks
            if (textBlocks.length > 0) {
                const combinedText = textBlocks.map(b => b.text).join('\n');
                renderMessage('assistant', combinedText);
            }

            // If no tool_use, we're done
            if (toolUseBlocks.length === 0) {
                return;
            }

            // Handle tool use — wait for user approval
            const toolResults = await handleToolUse(toolUseBlocks);

            // Add tool results as user message
            messages.push({ role: 'user', content: toolResults });
        }

        // Max iterations reached
        renderMessage('assistant', '(הגעתי למגבלת הפעולות לשאילתה אחת. אם צריך עוד, שלח הודעה חדשה.)');
    }

    // ==================== 6. handleToolUse() ====================

    async function handleToolUse(toolUseBlocks) {
        const results = [];

        // Validate all tool calls first
        const validatedCalls = toolUseBlocks.map(tu => {
            const error = validateToolCall(tu.name, tu.input);
            return { ...tu, validationError: error };
        });

        // Immediately return errors for invalid calls
        const invalidCalls = validatedCalls.filter(tc => tc.validationError);
        const validCalls = validatedCalls.filter(tc => !tc.validationError);

        for (const tc of invalidCalls) {
            results.push({
                type: 'tool_result',
                tool_use_id: tc.id,
                content: tc.validationError,
                is_error: true
            });
            renderMessage('error', tc.validationError);
        }

        if (validCalls.length === 0) return results;

        // Auto-approve read-only tools (execute immediately, no approval card)
        const autoApproved = validCalls.filter(tc => AUTO_APPROVE_TOOLS.has(tc.name));
        const needsApproval = validCalls.filter(tc => !AUTO_APPROVE_TOOLS.has(tc.name));

        for (const tc of autoApproved) {
            try {
                const execResult = await executeToolCall(tc.name, tc.input);
                await refreshAfterAction(tc.name);
                results.push({ type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(execResult) });
            } catch (err) {
                results.push({ type: 'tool_result', tool_use_id: tc.id, content: `שגיאה: ${err.message}`, is_error: true });
            }
        }

        if (needsApproval.length === 0) return results;

        // Show approval UI and wait for decisions
        let decisions;
        if (needsApproval.length > BATCH_THRESHOLD) {
            decisions = await showBatchApproval(needsApproval);
        } else {
            decisions = await showIndividualApproval(needsApproval);
        }

        // Execute approved calls and collect results
        for (const { toolCall, approved } of decisions) {
            if (!approved) {
                results.push({
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content: 'המשתמש ביטל את הפעולה'
                });
                continue;
            }

            try {
                const execResult = await executeToolCall(toolCall.name, toolCall.input);
                await refreshAfterAction(toolCall.name);
                results.push({
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content: JSON.stringify(execResult)
                });
            } catch (err) {
                results.push({
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content: `שגיאה: ${err.message}`,
                    is_error: true
                });
            }
        }

        return results;
    }

    // ==================== 7. validateToolCall() ====================

    function validateToolCall(toolName, input) {
        // Check report_id exists
        if (input.report_id && Array.isArray(clientsData)) {
            const client = clientsData.find(c => c.report_id === input.report_id);
            if (!client) {
                return `תיק לא נמצא: ${input.report_id}`;
            }
        }

        // Check stage validity
        if (toolName === 'move_to_stage' && input.new_stage) {
            if (!STAGES[input.new_stage]) {
                return `שלב לא תקין: ${input.new_stage}`;
            }
        }

        // Questionnaire only for Send_Questionnaire stage
        if (toolName === 'send_questionnaire' && input.report_id && Array.isArray(clientsData)) {
            const client = clientsData.find(c => c.report_id === input.report_id);
            if (client && client.stage !== 'Send_Questionnaire') {
                return `לא ניתן לשלוח שאלון — הלקוח בשלב ${STAGE_LABELS[client.stage] || client.stage}`;
            }
        }

        return null; // valid
    }

    // Fetch document details for a client (GET endpoint, Bearer auth)
    async function fetchClientDocuments(reportId) {
        const resp = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${reportId}&mode=office`,
            { headers: { 'Authorization': `Bearer ${authToken}` } },
            FETCH_TIMEOUTS.load
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || 'Failed to fetch documents');

        // Flatten and summarize: extract doc name + status from groups[].categories[].docs[]
        const docs = [];
        for (const group of (data.groups || [])) {
            for (const cat of (group.categories || [])) {
                for (const doc of (cat.docs || [])) {
                    docs.push({
                        name: doc.title || doc.name || 'ללא שם',
                        status: doc.status || 'Required_Missing',
                        person: group.person_label || group.person_label_he || ''
                    });
                }
            }
        }
        const received = docs.filter(d => d.status === 'Received').length;
        const missing = docs.filter(d => d.status === 'Required_Missing').length;
        const needsFix = docs.filter(d => d.status === 'Requires_Fix').length;
        return { documents: docs, summary: { total: docs.length, received, missing, needs_fix: needsFix } };
    }

    // ==================== 8. executeToolCall() ====================

    async function executeToolCall(toolName, input) {
        let url, body;

        switch (toolName) {
            case 'move_to_stage':
                url = ENDPOINTS.ADMIN_CHANGE_STAGE;
                body = { token: authToken, report_id: input.report_id, target_stage: input.new_stage };
                break;

            case 'send_reminder':
                url = ENDPOINTS.ADMIN_REMINDERS;
                // force_override: true — chatbot has its own approval flow, skip endpoint warning gate
                body = { token: authToken, action: 'send_now', report_ids: [input.report_id], force_override: true };
                break;

            case 'add_note':
                url = ENDPOINTS.ADMIN_UPDATE_CLIENT;
                body = { token: authToken, report_id: input.report_id, action: 'update-notes', notes: input.note_text };
                break;

            case 'suppress_reminder':
                url = ENDPOINTS.ADMIN_REMINDERS;
                body = { token: authToken, action: input.suppress ? 'suppress_forever' : 'unsuppress', report_ids: [input.report_id] };
                break;

            case 'change_reminder_date':
                url = ENDPOINTS.ADMIN_REMINDERS;
                body = { token: authToken, action: 'change_date', report_ids: [input.report_id], value: input.new_date };
                break;

            case 'send_questionnaire':
                url = ENDPOINTS.ADMIN_SEND_QUESTIONNAIRES;
                body = { token: authToken, report_ids: [input.report_id] };
                break;

            case 'get_client_documents':
                return await fetchClientDocuments(input.report_id);

            case 'send_feedback':
                url = ENDPOINTS.ADMIN_SEND_FEEDBACK;
                body = { token: authToken, subject: input.subject, message: input.message };
                break;

            default:
                throw new Error(`כלי לא מוכר: ${toolName}`);
        }

        const resp = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);

        if (!resp.ok) {
            const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
            throw new Error(errText);
        }
        const data = await resp.json();
        if (data.error) {
            throw new Error(data.error);
        }
        return data;
    }

    // ==================== 9. refreshAfterAction() ====================

    async function refreshAfterAction(toolName) {
        try {
            switch (toolName) {
                case 'move_to_stage':
                case 'add_note':
                case 'send_questionnaire':
                case 'send_feedback':
                    await loadDashboard(true);
                    break;
                case 'get_client_documents':
                    // Read-only, no refresh needed
                    break;
                case 'send_reminder':
                case 'suppress_reminder':
                case 'change_reminder_date':
                    await loadReminders(true);
                    break;
            }
        } catch (err) {
            console.warn('Chat: silent refresh failed:', err);
        }
    }

    // ==================== 10. renderMessage() ====================

    function renderMessage(role, content) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const wrapper = document.createElement('div');
        wrapper.className = `chat-msg chat-msg-${role}`;

        if (role === 'error') {
            wrapper.className = 'chat-msg chat-msg-error';
            wrapper.textContent = content;
        } else if (role === 'user') {
            wrapper.textContent = content;
        } else {
            // Assistant — streaming typewriter effect
            const html = formatAssistantContent(content);
            wrapper.innerHTML = '';
            container.appendChild(wrapper);
            container.scrollTop = container.scrollHeight;
            typewriterEffect(wrapper, html, container);
            return;
        }

        container.appendChild(wrapper);
        container.scrollTop = container.scrollHeight;
    }

    function typewriterEffect(element, html, scrollContainer) {
        // Parse HTML into a temporary container to extract word-level chunks
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const chunks = [];
        extractChunks(tmp, chunks);

        // Add blinking cursor
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        element.appendChild(cursor);

        let i = 0;
        const speed = 20; // ms per chunk

        function tick() {
            if (i >= chunks.length) {
                cursor.remove();
                return;
            }
            const chunk = chunks[i++];
            // Insert before cursor
            if (chunk.type === 'node') {
                element.insertBefore(chunk.value, cursor);
            } else {
                // text — append word by word into current text node or create one
                const textNode = document.createTextNode(chunk.value);
                element.insertBefore(textNode, cursor);
            }
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            requestAnimationFrame(() => setTimeout(tick, speed));
        }
        tick();
    }

    function extractChunks(node, chunks) {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                // Split text into words, preserving spaces
                const words = child.textContent.match(/\S+\s*/g) || [];
                for (const w of words) {
                    chunks.push({ type: 'text', value: w });
                }
            } else {
                // Element node — add as a single chunk (tables, links, brs, etc.)
                chunks.push({ type: 'node', value: child.cloneNode(true) });
            }
        }
    }

    function formatAssistantContent(text) {
        if (!text) return '';

        // Escape HTML first (except for our transforms below)
        let html = escapeHtml(text);

        // Markdown tables → HTML tables
        html = parseMarkdownTables(html);

        // <client>name|report_id</client> → clickable link
        // Since we escaped HTML, the tags are now &lt;client&gt;...&lt;/client&gt;
        // Validate report_id format (Airtable IDs: rec + 14 alphanumeric chars) to prevent XSS
        html = html.replace(/&lt;client&gt;(.+?)(?:::|[|\\,]|\s+)(rec[A-Za-z0-9]{14})&lt;\/client&gt;/g, (_, name, id) => {
            return `<a class="client-link" data-report-id="${id}" tabindex="0">${escapeHtml2(name.trim())}</a>`;
        });

        // **bold** → <strong>
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Newlines → <br>
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    function parseMarkdownTables(text) {
        // Match markdown table blocks (header | sep | rows)
        const tableRegex = /(?:^|\n)(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)+)/g;
        return text.replace(tableRegex, (match, header, sep, body) => {
            const parseRow = row => row.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());

            const headers = parseRow(header);
            const rows = body.trim().split('\n').map(parseRow);

            let table = '<div dir="rtl"><table class="table"><thead><tr>';
            headers.forEach(h => { table += `<th>${h}</th>`; });
            table += '</tr></thead><tbody>';
            rows.forEach(row => {
                table += '<tr>';
                row.forEach(cell => { table += `<td>${cell}</td>`; });
                table += '</tr>';
            });
            table += '</tbody></table></div>';
            return table;
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Second pass escape for values inserted into already-escaped HTML
    function escapeHtml2(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ==================== 11. renderApprovalCard() ====================

    function renderApprovalCard(toolUse, onDecision) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'chat-approval-card';

        const label = getApprovalLabel(toolUse.name, toolUse.input);
        card.innerHTML = `
            <div class="chat-approval-label">${escapeHtml(label)}</div>
            <div class="chat-approval-buttons">
                <button class="chat-btn chat-btn-approve">אשר ✓</button>
                <button class="chat-btn chat-btn-deny">דחה ✗</button>
            </div>
        `;

        const approveBtn = card.querySelector('.chat-btn-approve');
        const denyBtn = card.querySelector('.chat-btn-deny');

        approveBtn.addEventListener('click', () => {
            card.classList.add('chat-approved');
            approveBtn.disabled = true;
            denyBtn.disabled = true;
            card.querySelector('.chat-approval-buttons').innerHTML = '<span class="chat-status-approved">✓ אושר</span>';
            onDecision(true);
        });

        denyBtn.addEventListener('click', () => {
            card.classList.add('chat-denied');
            approveBtn.disabled = true;
            denyBtn.disabled = true;
            card.querySelector('.chat-approval-buttons').innerHTML = '<span class="chat-status-denied">✗ נדחה</span>';
            onDecision(false);
        });

        container.appendChild(card);
        container.scrollTop = container.scrollHeight;
    }

    function getApprovalLabel(toolName, input) {
        const client = clientsData.find(c => c.report_id === input.report_id);
        const clientName = client?.name || input.report_id;

        switch (toolName) {
            case 'move_to_stage': {
                const stageLabel = STAGE_LABELS[input.new_stage] || input.new_stage;
                return `העברת ${clientName} לשלב ${stageLabel}`;
            }
            case 'send_reminder':
                return `שליחת תזכורת ל${clientName}`;
            case 'add_note':
                return `הוספת הערה ל${clientName}: ${input.note_text}`;
            case 'suppress_reminder':
                return input.suppress
                    ? `השהיית תזכורות ל${clientName}`
                    : `הפעלת תזכורות ל${clientName}`;
            case 'send_questionnaire':
                return `שליחת שאלון ל${clientName}`;
            case 'change_reminder_date':
                return `שינוי תאריך תזכורת של ${clientName} ל-${input.new_date}`;
            case 'get_client_documents':
                return `שליפת מסמכים של ${clientName}`;
            case 'send_feedback':
                return `שליחת משוב: ${input.subject}`;
            default:
                return `${toolName}: ${JSON.stringify(input)}`;
        }
    }

    // ==================== 12. renderBatchCard() ====================

    function renderBatchCard(toolUses, onDecision) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'chat-batch-card';

        // Build summary
        const summary = toolUses.map(tu => getApprovalLabel(tu.name, tu.input));
        const listHtml = summary.map(s => `<li>${escapeHtml(s)}</li>`).join('');

        card.innerHTML = `
            <div class="chat-batch-header">${toolUses.length} פעולות ממתינות לאישור:</div>
            <ul class="chat-batch-list">${listHtml}</ul>
            <div class="chat-approval-buttons">
                <button class="chat-btn chat-btn-approve">אשר הכל ✓</button>
                <button class="chat-btn chat-btn-deny">בטל הכל ✗</button>
            </div>
        `;

        const approveBtn = card.querySelector('.chat-btn-approve');
        const denyBtn = card.querySelector('.chat-btn-deny');

        approveBtn.addEventListener('click', () => {
            approveBtn.disabled = true;
            denyBtn.disabled = true;
            card.querySelector('.chat-approval-buttons').innerHTML = '<span class="chat-status-approved">✓ הכל אושר</span>';
            onDecision(true);
        });

        denyBtn.addEventListener('click', () => {
            approveBtn.disabled = true;
            denyBtn.disabled = true;
            card.querySelector('.chat-approval-buttons').innerHTML = '<span class="chat-status-denied">✗ הכל בוטל</span>';
            onDecision(false);
        });

        container.appendChild(card);
        container.scrollTop = container.scrollHeight;
    }

    // Approval flow helpers

    function showIndividualApproval(toolCalls) {
        return new Promise((resolve, reject) => {
            pendingApprovalReject = reject;
            const decisions = [];
            let remaining = toolCalls.length;

            toolCalls.forEach(tc => {
                renderApprovalCard(tc, approved => {
                    decisions.push({ toolCall: tc, approved });
                    remaining--;
                    if (remaining === 0) {
                        pendingApprovalReject = null;
                        resolve(decisions);
                    }
                });
            });
        });
    }

    function showBatchApproval(toolCalls) {
        return new Promise((resolve, reject) => {
            pendingApprovalReject = reject;
            renderBatchCard(toolCalls, approveAll => {
                pendingApprovalReject = null;
                const decisions = toolCalls.map(tc => ({ toolCall: tc, approved: approveAll }));
                resolve(decisions);
            });
        });
    }

    // ==================== 13. UI EVENT HANDLERS ====================

    function toggleChat() {
        isOpen = !isOpen;
        sessionStorage.setItem('chatbot_open', isOpen ? 'true' : 'false');
        const panel = document.getElementById('chatPanel');
        const fab = document.getElementById('chatFab');
        if (panel) panel.classList.toggle('chat-open', isOpen);
        if (fab) fab.classList.toggle('chat-fab-hidden', isOpen);

        // Mobile full-screen mode
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            document.body.classList.toggle('chat-fullscreen', isOpen);
            document.body.style.overflow = isOpen ? 'hidden' : '';
            if (isOpen) {
                setTimeout(() => {
                    const input = document.getElementById('chatInput');
                    if (input) input.focus();
                }, 300);
            }
        }

        // Cancel pending approval if closing while waiting
        if (!isOpen && pendingApprovalReject) {
            pendingApprovalReject(new Error('cancelled'));
            pendingApprovalReject = null;
        }
    }

    function handleSend() {
        const input = document.getElementById('chatInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        sendMessage(text);
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        if (e.key === 'Escape' && isOpen) {
            toggleChat();
        }
    }

    function handleSuggestionClick(text) {
        const input = document.getElementById('chatInput');
        if (input) input.value = text;
        handleSend();
    }

    function clearSuggestionChips() {
        const chips = document.getElementById('chatSuggestions');
        if (chips) chips.style.display = 'none';
    }

    function setLoading(loading) {
        isLoading = loading;
        const indicator = document.getElementById('chatLoading');
        const sendBtn = document.getElementById('chatSendBtn');
        const input = document.getElementById('chatInput');
        if (indicator) indicator.style.display = loading ? 'flex' : 'none';
        if (sendBtn) sendBtn.disabled = loading;
        if (input) input.disabled = loading;
    }

    function trimMessages() {
        if (messages.length > MAX_HISTORY) {
            messages = messages.slice(messages.length - MAX_HISTORY);
        }
    }

    // ==================== 14. createWidgetHTML() ====================

    function createWidgetHTML() {
        const widget = document.getElementById('chatWidget');
        if (!widget) return;

        const suggestions = [
            'כמה לקוחות בכל שלב?',
            'מי תקוע הכי הרבה זמן?',
            'לקוחות עם מסמכים חסרים',
            'סיכום כללי'
        ];

        const chipsHtml = suggestions.map(s =>
            `<button class="chat-chip" onclick="window._chatbot.suggest('${s.replace(/'/g, "\\'")}')">${escapeHtml(s)}</button>`
        ).join('');

        widget.innerHTML = `
            <button id="chatFab" class="chat-fab ${isOpen ? 'chat-fab-hidden' : ''}" onclick="window._chatbot.toggle()" title="צ'אט AI">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>

            <div id="chatPanel" class="chat-panel ${isOpen ? 'chat-open' : ''}">
                <div class="chat-header">
                    <span class="chat-header-title">🤖 עוזר AI</span>
                    <button class="chat-close-btn" onclick="window._chatbot.toggle()" title="סגור">✕</button>
                </div>

                <div id="chatMessages" class="chat-messages">
                    <div class="chat-msg chat-msg-assistant">שלום! אני העוזר החכם של הפאנל. אפשר לשאול אותי על לקוחות, שלבים, מסמכים, ועוד. אני גם יכול לבצע פעולות עם אישור שלך.</div>
                    <div id="chatSuggestions" class="chat-suggestions">${chipsHtml}</div>
                </div>

                <div id="chatLoading" class="chat-loading" style="display:none">
                    <div class="chat-loading-dots"><span></span><span></span><span></span></div>
                </div>

                <div class="chat-input-row">
                    <textarea id="chatInput" class="chat-input" placeholder="שאל שאלה..." rows="1" onkeydown="window._chatbot.keydown(event)"></textarea>
                    <button id="chatSendBtn" class="chat-send-btn" onclick="window._chatbot.send()" title="שלח">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    function setupKeyboardHandling() {
        if (!window.visualViewport) return;
        const panel = document.getElementById('chatPanel');
        if (!panel) return;

        window.visualViewport.addEventListener('resize', () => {
            if (!isOpen) return;
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            if (!isMobile) return;
            // Offset = difference between layout viewport and visual viewport
            const offset = window.innerHeight - window.visualViewport.height;
            panel.style.height = offset > 0
                ? `${window.visualViewport.height}px`
                : '100dvh';
        });
    }

    // ==================== 15. init() ====================

    function init() {
        createWidgetHTML();
        setupKeyboardHandling();

        // Delegated click handler for client links (data-report-id)
        const messagesEl = document.getElementById('chatMessages');
        if (messagesEl) {
            messagesEl.addEventListener('click', (e) => {
                const link = e.target.closest('.client-link[data-report-id]');
                if (link) {
                    e.preventDefault();
                    viewClientDocs(link.dataset.reportId);
                }
            });
        }

        // Expose minimal API for inline event handlers
        window._chatbot = {
            toggle: toggleChat,
            send: handleSend,
            keydown: handleKeyDown,
            suggest: handleSuggestionClick
        };
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
