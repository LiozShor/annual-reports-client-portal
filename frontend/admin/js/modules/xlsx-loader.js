// Lazy UMD script-tag loader for SheetJS.
// Resolves immediately if window.XLSX already exists (sync <script> tag still present).
// Load this module before script.js; script.js calls window.ensureXLSX().
(function () {
    let _xlsxPromise = null;

    window.ensureXLSX = function ensureXLSX() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (_xlsxPromise) return _xlsxPromise;
        _xlsxPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            s.onload = function () { resolve(window.XLSX); };
            s.onerror = function () { _xlsxPromise = null; reject(new Error('Failed to load XLSX')); };
            document.head.appendChild(s);
        });
        return _xlsxPromise;
    };
}());
