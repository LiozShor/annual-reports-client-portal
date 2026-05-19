/**
 * DL-405 — Unified Client Row Actions Menu
 *
 * Single source of truth for the actions available on a client dashboard row.
 * Used by all three render sites that previously hand-edited two parallel
 * HTML strings:
 *   - right-click context menu (#clientContextMenu)
 *   - desktop kebab `.row-menu` (per-row)
 *   - mobile kebab `.row-menu` (per-card)
 *
 * Exposed on window:
 *   - buildClientRowActionsHtml(client, { rid, isActive, stage })
 *       Returns the inner HTML for either menu container (identical output).
 *   - openClientContextMenuAt(x, y, client, opts?)
 *       Opens the singleton #clientContextMenu at viewport coords.
 *       Used by right-click and mobile long-press.
 *   - attachLongPressMenu(rootEl)
 *       Wires touchstart/move/end on a container — long-press (≥500ms) on
 *       any descendant `[data-report-id]` opens the menu at finger position.
 *   - clientRowActionsMenuKeydown(e)
 *       Keyboard nav handler attached to menu containers.
 *
 * Items, predicates, labels, onclick handlers all live in `_buildItems()`
 * — adding or editing a menu action means editing exactly one place.
 */
(function () {
    'use strict';

    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOLERANCE = 10; // px

    /* ------------------------------------------------------------------ */
    /* Item model                                                          */
    /* ------------------------------------------------------------------ */

    function _buildItems(client, ctx) {
        const { rid, cName, isActive, stage, stageNum } = ctx;
        const otherType = (typeof getClientOtherFilingType === 'function')
            ? getClientOtherFilingType(client && client.email, client && client.year)
            : null;
        const otherTypeLabel = otherType && (typeof FILING_TYPE_LABELS !== 'undefined')
            ? FILING_TYPE_LABELS[otherType] : '';
        const ccLabel = (client && client.cc_email) ? 'ערוך אימייל משני' : 'הוסף אימייל משני';
        const safeStage = String(stage || '').replace(/'/g, "\\'");

        return [
            // ---- Group 1: Send actions ----
            {
                group: 'send',
                show: isActive && stage === 'Send_Questionnaire',
                icon: 'send',
                label: 'שלח שאלון',
                onClick: `sendSingle('${rid}')`,
            },
            {
                group: 'send',
                show: isActive && (stage === 'Waiting_For_Answers' || stage === 'Collecting_Docs'),
                icon: 'bell-ring',
                label: 'שלח תזכורת',
                onClick: `sendDashboardReminder('${rid}', '${cName}')`,
            },
            {
                group: 'send',
                show: isActive && (stage === 'Send_Questionnaire' || stage === 'Waiting_For_Answers'),
                icon: 'user-pen',
                label: 'מלא שאלון במקום הלקוח',
                onClick: `openAssistedQuestionnaire('${rid}', '${cName}')`,
            },

            // ---- Group 2: View actions ----
            {
                group: 'view',
                show: isActive && stageNum >= 3,
                icon: 'file-text',
                label: 'צפה בשאלון',
                onClick: `viewQuestionnaire('${rid}')`,
            },
            {
                group: 'view',
                show: true,
                icon: 'external-link',
                label: 'צפייה כלקוח',
                onClick: `viewClient('${rid}')`,
            },
            {
                group: 'view',
                show: isActive && stageNum >= 1 && stageNum <= 3,
                icon: 'copy',
                label: 'העתק קישור לשאלון',
                onClick: `copyQuestionnaireLink('${rid}')`,
            },

            // ---- Group 3: Edit actions ----
            // DL-426: urgent toggle. Label flips on current state.
            {
                group: 'edit',
                show: isActive,
                icon: 'flame',
                label: (window.UrgentFlag && window.UrgentFlag.isUrgent(client)) ? 'הסר סימון דחוף' : 'סמן כדחוף',
                onClick: `window.UrgentFlag && window.UrgentFlag.toggle('${rid}', ${(window.UrgentFlag && window.UrgentFlag.isUrgent(client)) ? 'true' : 'false'})`,
            },
            {
                group: 'edit',
                show: isActive,
                icon: 'users',
                label: ccLabel,
                onClick: `openCcEmailFromKebab('${rid}', '${safeStage}')`,
            },
            {
                group: 'edit',
                show: isActive && Boolean(otherType),
                icon: 'file-plus',
                label: `הוסף ${otherTypeLabel}`,
                onClick: `addSecondFilingType('${rid}')`,
            },
            {
                group: 'edit',
                show: isActive,
                icon: 'merge',
                label: 'מזג עם לקוח אחר',
                onClick: `openMergeClientsDialog('${rid}', '${cName}')`,
            },

            // ---- Group 4: Danger actions ----
            {
                group: 'danger',
                show: isActive,
                icon: 'archive',
                danger: true,
                label: 'העבר לארכיון',
                onClick: `deactivateClient('${rid}', '${cName}')`,
            },
            {
                group: 'danger',
                show: !isActive,
                icon: 'archive-restore',
                label: 'הפעל מחדש',
                onClick: `reactivateClient('${rid}')`,
            },
        ].filter(i => i.show);
    }

    /* ------------------------------------------------------------------ */
    /* Renderer                                                            */
    /* ------------------------------------------------------------------ */

    function _renderItems(items) {
        const groups = ['send', 'view', 'edit', 'danger'];
        const buckets = groups
            .map(g => items.filter(i => i.group === g))
            .filter(b => b.length > 0);

        const iconFn = (typeof icon === 'function') ? icon : (n => `<i data-lucide="${n}"></i>`);

        return buckets
            .map(b => b.map(i => {
                const cls = i.danger ? ' class="danger"' : '';
                return `<button role="menuitem"${cls} onclick="${i.onClick}; closeAllRowMenus();">${iconFn(i.icon)} ${i.label}</button>`;
            }).join(''))
            .join('<hr>');
    }

    /* ------------------------------------------------------------------ */
    /* Public: build HTML                                                  */
    /* ------------------------------------------------------------------ */

    function buildClientRowActionsHtml(client, opts) {
        opts = opts || {};
        const rid = opts.rid != null ? opts.rid : (client && client.report_id);
        const stage = opts.stage != null ? opts.stage : (client && client.stage);
        const isActive = (opts.isActive !== undefined)
            ? !!opts.isActive
            : (client ? client.is_active !== false : true);
        const cNameRaw = (client && client.name) || '';
        const cName = (typeof escapeAttr === 'function') ? escapeAttr(cNameRaw) : String(cNameRaw).replace(/"/g, '&quot;');
        const stageNum = (typeof STAGES !== 'undefined' && STAGES[stage] && STAGES[stage].num) || 0;

        const items = _buildItems(client || {}, {
            rid: String(rid || ''),
            cName,
            isActive,
            stage,
            stageNum,
        });
        return _renderItems(items);
    }

    /* ------------------------------------------------------------------ */
    /* Public: open singleton at coords                                    */
    /* ------------------------------------------------------------------ */

    function _positionMenuAt(menu, x, y) {
        menu.style.display = 'block';
        menu.style.visibility = 'hidden';
        const mRect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let top = y;
        let left = x;
        if (top + mRect.height > vh - 8) top = vh - mRect.height - 8;
        if (left + mRect.width > vw - 8) left = vw - mRect.width - 8;
        if (top < 8) top = 8;
        if (left < 8) left = 8;
        menu.style.top = top + 'px';
        menu.style.right = 'auto';
        menu.style.left = left + 'px';
        menu.style.bottom = '';
        menu.style.maxHeight = '';
        menu.style.visibility = '';
        menu.classList.add('open');
    }

    function openClientContextMenuAt(x, y, client) {
        if (typeof closeAllRowMenus === 'function') closeAllRowMenus();
        const menu = document.getElementById('clientContextMenu');
        if (!menu) return;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = buildClientRowActionsHtml(client, {
            rid: client && client.report_id,
            stage: client && client.stage,
            isActive: client ? client.is_active !== false : true,
        });
        _positionMenuAt(menu, x, y);
        if (typeof safeCreateIcons === 'function') safeCreateIcons(menu);
        // Focus the first menuitem so keyboard users can immediately navigate.
        const first = menu.querySelector('button[role="menuitem"]');
        if (first) first.focus();
    }

    /* ------------------------------------------------------------------ */
    /* Public: long-press wiring                                           */
    /* ------------------------------------------------------------------ */

    function attachLongPressMenu(rootEl) {
        if (!rootEl || rootEl.__dl405LongPressBound) return;
        rootEl.__dl405LongPressBound = true;

        let timer = null;
        let startX = 0, startY = 0;
        let firedAt = 0;
        let suppressClickUntil = 0;

        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

        rootEl.addEventListener('touchstart', (e) => {
            const target = e.target.closest('[data-report-id]');
            if (!target) return;
            // Don't long-press on interactive sub-elements (buttons, inputs, links).
            if (e.target.closest('button, input, a, .stage-badge, .clickable-count, .clickable-docs, .notes-cell, .checkbox-cell, .mobile-card-checkbox, .mobile-card-name')) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            startX = t.clientX;
            startY = t.clientY;
            cancel();
            timer = setTimeout(() => {
                timer = null;
                firedAt = Date.now();
                suppressClickUntil = firedAt + 400;
                const rid = target.dataset.reportId;
                const client = (typeof clientsData !== 'undefined')
                    ? clientsData.find(c => c.report_id === rid)
                    : null;
                if (!client) return;
                openClientContextMenuAt(startX, startY, client);
            }, LONG_PRESS_MS);
        }, { passive: true });

        rootEl.addEventListener('touchmove', (e) => {
            const t = e.touches && e.touches[0];
            if (!t) return;
            if (Math.abs(t.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE ||
                Math.abs(t.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) {
                cancel();
            }
        }, { passive: true });

        rootEl.addEventListener('touchend', cancel, { passive: true });
        rootEl.addEventListener('touchcancel', cancel, { passive: true });

        // Suppress synthetic click that follows a long-press, so the row
        // doesn't also fire its tap-to-open behavior.
        rootEl.addEventListener('click', (e) => {
            if (Date.now() < suppressClickUntil) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true);
    }

    /* ------------------------------------------------------------------ */
    /* Public: keyboard navigation                                         */
    /* ------------------------------------------------------------------ */

    function _menuItems(container) {
        return Array.from(container.querySelectorAll('button[role="menuitem"]'));
    }

    function clientRowActionsMenuKeydown(e) {
        const container = e.currentTarget;
        const items = _menuItems(container);
        if (items.length === 0) return;
        const focusedIdx = items.indexOf(document.activeElement);

        switch (e.key) {
            case 'ArrowDown': {
                e.preventDefault();
                const next = items[(focusedIdx + 1 + items.length) % items.length] || items[0];
                next.focus();
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                const prev = items[(focusedIdx - 1 + items.length) % items.length] || items[items.length - 1];
                prev.focus();
                break;
            }
            case 'Home':
                e.preventDefault();
                items[0].focus();
                break;
            case 'End':
                e.preventDefault();
                items[items.length - 1].focus();
                break;
            case 'Escape':
                e.preventDefault();
                if (typeof closeAllRowMenus === 'function') closeAllRowMenus();
                break;
            case 'Tab':
                if (typeof closeAllRowMenus === 'function') closeAllRowMenus();
                break;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Wire keydown on the singleton context menu (one-time)               */
    /* ------------------------------------------------------------------ */

    function _wireSingletonKeydown() {
        const menu = document.getElementById('clientContextMenu');
        if (!menu || menu.__dl405KeydownBound) return;
        menu.__dl405KeydownBound = true;
        menu.setAttribute('role', 'menu');
        menu.addEventListener('keydown', clientRowActionsMenuKeydown);
    }

    // Delegated keydown for per-row .row-menu containers (rendered dynamically).
    function _wireDelegatedRowMenuKeydown() {
        if (document.__dl405DelegatedKeydown) return;
        document.__dl405DelegatedKeydown = true;
        document.addEventListener('keydown', (e) => {
            const rowMenu = e.target.closest && e.target.closest('.row-menu');
            if (!rowMenu) return;
            // Re-use the same handler — currentTarget would be document otherwise.
            clientRowActionsMenuKeydown({
                key: e.key,
                preventDefault: () => e.preventDefault(),
                currentTarget: rowMenu,
            });
        });
    }

    function _init() {
        _wireSingletonKeydown();
        _wireDelegatedRowMenuKeydown();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    /* ------------------------------------------------------------------ */
    /* Exports                                                              */
    /* ------------------------------------------------------------------ */

    window.buildClientRowActionsHtml = buildClientRowActionsHtml;
    window.openClientContextMenuAt = openClientContextMenuAt;
    window.attachLongPressMenu = attachLongPressMenu;
    window.clientRowActionsMenuKeydown = clientRowActionsMenuKeydown;
})();
