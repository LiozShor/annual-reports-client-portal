/* ===========================================
   SHARED UTILITIES
   Loaded before page-specific scripts via <script> tag.
   =========================================== */

/** Sanitize HTML: allow only <b> and <strong> tags, escape everything else */
function sanitizeDocHtml(html) {
    if (!html) return '';
    const el = document.createElement('div');
    el.textContent = html;
    let safe = el.innerHTML;
    safe = safe.replace(/&lt;b&gt;/gi, '<b>').replace(/&lt;\/b&gt;/gi, '</b>');
    safe = safe.replace(/&lt;strong&gt;/gi, '<strong>').replace(/&lt;\/strong&gt;/gi, '</strong>');
    return safe;
}
