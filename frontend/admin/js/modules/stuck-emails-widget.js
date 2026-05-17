/**
 * DL-417 — Stuck Email Events dev widget.
 *
 * Self-contained, gated behind ?dev=1. Renders a fixed-position toggle button
 * in the top-left and a slide-in panel listing inbound email_events whose
 * processing_status != 'Completed'. Read-only — pure monitoring surface, no
 * mutations. Designed so we (dev) can spot stuck emails fast without the
 * office team seeing the widget.
 *
 * Auth: uses the same admin Bearer token script.js stored under
 * localStorage 'adminToken'. Hits GET /webhook/admin-stuck-emails.
 *
 * Does NOT touch frontend/admin/js/script.js (monolith size ratchet).
 */
(function () {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    if (params.get('dev') !== '1') return; // gate: dev-only

    var API_BASE = (window.API_BASE || 'https://annual-reports-api.liozshor1.workers.dev/webhook') + '/admin-stuck-emails';
    var TOKEN_KEY = window.ADMIN_TOKEN_KEY || 'admin_token';
    var TIERS = [
        { maxHours: 24,       cls: 'aging-fresh', label: 'חדש' },
        { maxHours: 72,       cls: 'aging-day1',  label: '1-3 ימים' },
        { maxHours: 24 * 7,   cls: 'aging-aging', label: 'שבוע+' },
        { maxHours: Infinity, cls: 'aging-stale', label: 'ישן' }
    ];

    function getToken() {
        try {
            // Match admin panel: real key is in window.ADMIN_TOKEN_KEY ('admin_token').
            // Fall back to the in-memory authToken variable script.js sets at login.
            return localStorage.getItem(TOKEN_KEY) || (window.authToken || '') || '';
        } catch (_e) { return ''; }
    }

    function ageTier(iso) {
        if (!iso) return TIERS[TIERS.length - 1];
        var t = new Date(iso).getTime();
        if (!isFinite(t)) return TIERS[TIERS.length - 1];
        var hours = (Date.now() - t) / 36e5;
        for (var i = 0; i < TIERS.length; i++) if (hours < TIERS[i].maxHours) return TIERS[i];
        return TIERS[TIERS.length - 1];
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function fmtAge(hours) {
        if (hours == null) return '—';
        if (hours < 1) return Math.round(hours * 60) + 'm';
        if (hours < 48) return Math.round(hours) + 'h';
        return Math.round(hours / 24) + 'd';
    }

    var state = { open: false, loading: false, error: '', data: null, bucket: 'all' };

    function injectStyles() {
        if (document.getElementById('dl417-styles')) return;
        var css = ''
            + '#dl417-toggle{position:fixed;top:8px;left:8px;z-index:9998;background:#1f2937;color:#fbbf24;'
            + 'border:1px solid #fbbf24;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;'
            + 'font-family:ui-monospace,monospace;opacity:0.85}'
            + '#dl417-toggle:hover{opacity:1}'
            + '#dl417-toggle .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;margin-inline-end:6px;vertical-align:middle}'
            + '#dl417-panel{position:fixed;top:0;left:0;height:100vh;width:min(640px,95vw);background:#fff;'
            + 'box-shadow:2px 0 16px rgba(0,0,0,0.18);z-index:9999;display:flex;flex-direction:column;'
            + 'transform:translateX(-100%);transition:transform .2s ease;direction:rtl;font-family:system-ui,sans-serif}'
            + '#dl417-panel.open{transform:translateX(0)}'
            + '#dl417-panel header{padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;background:#f9fafb}'
            + '#dl417-panel header h2{margin:0;font-size:14px;font-weight:600;flex:1;color:#111827}'
            + '#dl417-panel header button{background:none;border:1px solid #d1d5db;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px}'
            + '#dl417-panel .counts{display:flex;gap:6px;padding:8px 14px;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;background:#fafafa}'
            + '#dl417-panel .count-pill{padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;border:1px solid #d1d5db;background:#fff;color:#374151}'
            + '#dl417-panel .count-pill.active{background:#1f2937;color:#fff;border-color:#1f2937}'
            + '#dl417-panel .count-pill.stuck{border-color:#dc2626;color:#991b1b}'
            + '#dl417-panel .count-pill.action{border-color:#d97706;color:#92400e}'
            + '#dl417-panel .count-pill.terminal{border-color:#6b7280;color:#374151}'
            + '#dl417-panel .body{flex:1;overflow-y:auto;padding:8px 14px}'
            + '#dl417-panel .row{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;background:#fff}'
            + '#dl417-panel .row .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}'
            + '#dl417-panel .row .status{font-family:ui-monospace,monospace;font-weight:600}'
            + '#dl417-panel .row .meta{color:#6b7280;font-size:11px;margin-top:3px}'
            + '#dl417-panel .row .subject{color:#111827;margin-top:3px;direction:ltr;text-align:start;font-family:system-ui,sans-serif;word-break:break-word}'
            + '#dl417-panel .row .err{color:#991b1b;font-family:ui-monospace,monospace;font-size:11px;margin-top:4px;padding:4px 6px;background:#fef2f2;border-radius:4px;direction:ltr;text-align:start;white-space:pre-wrap}'
            + '#dl417-panel .row .badges{display:inline-flex;gap:4px;margin-top:4px}'
            + '#dl417-panel .row .badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:10px;background:#e5e7eb;color:#374151}'
            + '#dl417-panel .row .badge.ok{background:#d1fae5;color:#065f46}'
            + '#dl417-panel .row.bucket-stuck{border-inline-start:3px solid #dc2626}'
            + '#dl417-panel .row.bucket-action-required{border-inline-start:3px solid #d97706}'
            + '#dl417-panel .row.bucket-terminal{border-inline-start:3px solid #6b7280}'
            + '#dl417-panel .row .age.aging-fresh{color:#065f46}'
            + '#dl417-panel .row .age.aging-day1{color:#92400e}'
            + '#dl417-panel .row .age.aging-aging{color:#9a3412}'
            + '#dl417-panel .row .age.aging-stale{color:#7f1d1d;font-weight:600}'
            + '#dl417-panel a.airtable{color:#2563eb;text-decoration:none;font-size:11px}'
            + '#dl417-panel a.airtable:hover{text-decoration:underline}'
            + '#dl417-panel .empty{padding:24px;text-align:center;color:#6b7280;font-size:13px}'
            + '#dl417-panel .err-banner{padding:10px 14px;background:#fef2f2;color:#991b1b;font-size:12px;direction:ltr;text-align:start}';
        var style = document.createElement('style');
        style.id = 'dl417-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function renderToggle() {
        var btn = document.getElementById('dl417-toggle');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'dl417-toggle';
            btn.title = 'DL-417 stuck inbound emails (dev)';
            btn.addEventListener('click', toggle);
            document.body.appendChild(btn);
        }
        var total = state.data ? state.data.counts : null;
        var stuckCount = total ? (total.stuck || 0) : '?';
        btn.innerHTML = (stuckCount && stuckCount !== '?' && stuckCount > 0 ? '<span class="dot"></span>' : '') + '✉ stuck: ' + escapeHtml(stuckCount);
    }

    function renderPanel() {
        var panel = document.getElementById('dl417-panel');
        if (!panel) {
            panel = document.createElement('aside');
            panel.id = 'dl417-panel';
            document.body.appendChild(panel);
        }
        if (state.open) panel.classList.add('open');
        else panel.classList.remove('open');

        var c = (state.data && state.data.counts) || { stuck: 0, 'action-required': 0, terminal: 0, unknown: 0 };
        var rows = (state.data && state.data.rows) || [];

        var html = ''
            + '<header>'
            + '<h2>📨 דוא"ל תקועים (DL-417 · dev)</h2>'
            + '<button type="button" data-action="refresh">↻ רענן</button>'
            + '<button type="button" data-action="close">סגור</button>'
            + '</header>'
            + '<div class="counts">'
            + countPill('all',              'הכל (' + (c.stuck + c['action-required'] + c.terminal + c.unknown) + ')', '')
            + countPill('stuck',            'תקוע (' + c.stuck + ')', 'stuck')
            + countPill('action-required',  'דורש פעולה (' + c['action-required'] + ')', 'action')
            + countPill('terminal',         'סופי (' + c.terminal + ')', 'terminal')
            + '</div>';

        if (state.loading) html += '<div class="empty">טוען…</div>';
        else if (state.error) html += '<div class="err-banner">' + escapeHtml(state.error) + '</div>';
        else if (rows.length === 0) html += '<div class="empty">אין רשומות בדלי הנבחר ✅</div>';
        else {
            html += '<div class="body">';
            for (var i = 0; i < rows.length; i++) html += renderRow(rows[i]);
            html += '</div>';
        }

        panel.innerHTML = html;
        var refreshBtn = panel.querySelector('[data-action="refresh"]');
        if (refreshBtn) refreshBtn.addEventListener('click', function () { fetchData(true); });
        var closeBtn = panel.querySelector('[data-action="close"]');
        if (closeBtn) closeBtn.addEventListener('click', toggle);
        var pills = panel.querySelectorAll('.count-pill');
        for (var j = 0; j < pills.length; j++) pills[j].addEventListener('click', onPillClick);
    }

    function countPill(bucket, label, extraCls) {
        var cls = 'count-pill';
        if (extraCls) cls += ' ' + extraCls;
        if (state.bucket === bucket) cls += ' active';
        return '<button type="button" class="' + cls + '" data-bucket="' + escapeHtml(bucket) + '">' + escapeHtml(label) + '</button>';
    }

    function onPillClick(e) {
        var bkt = e.currentTarget.getAttribute('data-bucket');
        if (!bkt || bkt === state.bucket) return;
        state.bucket = bkt;
        renderPanel(); // immediate re-filter from cached rows
    }

    function renderRow(r) {
        var tier = ageTier(r.received_at);
        var ageStr = fmtAge(r.age_hours);
        var bucketClass = 'bucket-' + r.bucket;
        var senderAtMasked = r.sender_email ? r.sender_email.replace(/(^.).*(@.*$)/, '$1•••$2') : '—';
        var subject = r.subject || '(no subject)';
        var badges = '';
        if (r.has_pending_classifications) badges += '<span class="badge ok">📎 PC</span>';
        if (r.has_matched_document) badges += '<span class="badge ok">📄 doc</span>';
        if (r.has_linked_report) badges += '<span class="badge">👤 client</span>';
        if (r.match_method) badges += '<span class="badge">' + escapeHtml(r.match_method) + '</span>';

        if (state.bucket !== 'all' && r.bucket !== state.bucket) return '';

        return ''
            + '<div class="row ' + bucketClass + '">'
            + '<div class="top">'
            + '<span class="status">' + escapeHtml(r.status) + '</span>'
            + '<span class="age ' + tier.cls + '">' + escapeHtml(ageStr) + '</span>'
            + '</div>'
            + '<div class="subject">' + escapeHtml(subject) + '</div>'
            + '<div class="meta">' + escapeHtml(senderAtMasked) + ' · ' + escapeHtml(r.received_at || '—') + '</div>'
            + (badges ? '<div class="badges">' + badges + '</div>' : '')
            + (r.error_message ? '<div class="err">' + (r.last_error_step ? '[' + escapeHtml(r.last_error_step) + '] ' : '') + escapeHtml(r.error_message) + '</div>' : '')
            + '<div style="margin-top:4px"><a class="airtable" href="' + escapeHtml(r.airtable_url) + '" target="_blank" rel="noopener">פתח ב-Airtable ↗</a></div>'
            + '</div>';
    }

    function fetchData(force) {
        if (state.loading) return;
        state.loading = true; state.error = '';
        renderPanel();

        var token = getToken();
        if (!token) {
            state.loading = false;
            state.error = 'No admin token in localStorage — login first.';
            renderPanel(); renderToggle();
            return;
        }

        var url = API_BASE + '?bucket=all&since=30d&limit=300' + (force ? '&_t=' + Date.now() : '');
        fetch(url, { headers: { Authorization: 'Bearer ' + token } })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
            .then(function (res) {
                state.loading = false;
                if (!res.ok || !res.body || res.body.ok === false) {
                    state.error = (res.body && (res.body.error || JSON.stringify(res.body))) || 'request failed';
                    state.data = null;
                } else {
                    state.data = res.body;
                    state.error = '';
                }
                renderPanel(); renderToggle();
            })
            .catch(function (e) {
                state.loading = false;
                state.error = String(e && e.message || e);
                renderPanel(); renderToggle();
            });
    }

    function toggle() {
        state.open = !state.open;
        renderPanel();
        if (state.open && !state.data) fetchData(false);
    }

    function init() {
        injectStyles();
        renderToggle();
        renderPanel();
        // Background prefetch so the dot lights up before the user clicks
        fetchData(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
