/**
 * DL-406 — Aging-color utility shared by the dashboard messages widget
 * and the review queue. Returns a CSS class + Hebrew label for a given
 * timestamp + tier config. Pair the color with the label/icon at the
 * call site (WCAG 1.4.1: never color alone).
 *
 * Extracted into a module because frontend/admin/js/script.js is on a
 * one-way size ratchet (see CLAUDE.md / .claude/script-size-baseline.json).
 *
 * Exposed on window:
 *   - AgingColors.TIERS_MESSAGES — tier list for the dashboard messages widget
 *   - AgingColors.TIERS_REVIEW   — tier list for the Moshe-Review queue
 *   - AgingColors.ageTier(isoDateOrTimestamp, tiers)
 *       Returns { maxHours, cls, label } — the first tier whose maxHours
 *       exceeds the elapsed hours. Falls through to the last tier on
 *       missing/invalid dates so stale rows still get a visual cue.
 */
(function () {
    'use strict';

    var TIERS_MESSAGES = [
        { maxHours: 24,       cls: 'aging-fresh', label: 'חדש' },
        { maxHours: 48,       cls: 'aging-day1',  label: 'יום' },
        { maxHours: 120,      cls: 'aging-aging', label: 'מתיישן' },
        { maxHours: Infinity, cls: 'aging-stale', label: 'מעופש' }
    ];

    var TIERS_REVIEW = [
        { maxHours: 24 * 7,   cls: 'aging-fresh', label: 'בזמן' },
        { maxHours: 24 * 14,  cls: 'aging-aging', label: 'ישן' },
        { maxHours: Infinity, cls: 'aging-stale', label: 'איחור' }
    ];

    function ageTier(isoDateOrTimestamp, tiers) {
        if (!isoDateOrTimestamp) return tiers[tiers.length - 1];
        var t = new Date(isoDateOrTimestamp).getTime();
        if (!isFinite(t)) return tiers[tiers.length - 1];
        var hours = (Date.now() - t) / 36e5;
        for (var i = 0; i < tiers.length; i++) {
            if (hours < tiers[i].maxHours) return tiers[i];
        }
        return tiers[tiers.length - 1];
    }

    window.AgingColors = {
        TIERS_MESSAGES: TIERS_MESSAGES,
        TIERS_REVIEW: TIERS_REVIEW,
        ageTier: ageTier
    };
})();
