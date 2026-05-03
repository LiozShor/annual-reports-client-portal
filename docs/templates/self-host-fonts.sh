#!/bin/bash
# ============================================================
# Self-Host Google Fonts — Amendment 13 Compliance (Finding 26)
#
# Eliminates IP address leakage to Google by hosting fonts locally.
# Currently used: Heebo (400,500,600,700) + Inter (400,500,600,700)
# Source: design-system.css line 7
#
# NOTE: Google serves different woff2 files per unicode-range subset
# under the same weight. This script downloads them but the file
# mapping (which hash-named file corresponds to which weight+subset)
# requires manual inspection. RECOMMENDED: Instead of running this
# script, ask Claude Code to do the font self-hosting as a task —
# it can handle the subset-to-weight file mapping cleanly.
#
# Run from: github/annual-reports-client-portal/
# ============================================================

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)/github/annual-reports-client-portal"
FONTS_DIR="$REPO_ROOT/assets/fonts"

echo "=== Self-Host Google Fonts ==="
echo "Target: $FONTS_DIR"
echo ""

# 1. Create fonts directory
mkdir -p "$FONTS_DIR"

# 2. Download Heebo (Hebrew + Latin, woff2)
echo "Downloading Heebo..."
curl -sL "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  -o /tmp/heebo.css

# Extract woff2 URLs from the CSS
grep -oP 'url\(\K[^)]+\.woff2' /tmp/heebo.css | while read -r url; do
  filename=$(echo "$url" | grep -oP '[^/]+$')
  echo "  → $filename"
  curl -sL "$url" -o "$FONTS_DIR/$filename"
done

# 3. Download Inter (Latin, woff2)
echo "Downloading Inter..."
curl -sL "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  -o /tmp/inter.css

grep -oP 'url\(\K[^)]+\.woff2' /tmp/inter.css | while read -r url; do
  filename=$(echo "$url" | grep -oP '[^/]+$')
  echo "  → $filename"
  curl -sL "$url" -o "$FONTS_DIR/$filename"
done

# 4. Generate local fonts.css
echo ""
echo "Generating assets/fonts/fonts.css..."

cat > "$FONTS_DIR/fonts.css" << 'CSSEOF'
/* ===========================================
   LOCAL FONTS — Self-hosted for privacy
   Replaces: @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
   Reason: Eliminates IP address leakage to Google (Amendment 13, Finding 26)
   =========================================== */

/* Heebo — Hebrew + Latin */
@font-face {
  font-family: 'Heebo';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./heebo-400.woff2') format('woff2');
  unicode-range: U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F, U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Heebo';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('./heebo-500.woff2') format('woff2');
  unicode-range: U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F, U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Heebo';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('./heebo-600.woff2') format('woff2');
  unicode-range: U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F, U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Heebo';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('./heebo-700.woff2') format('woff2');
  unicode-range: U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F, U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Inter — Latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./inter-400.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('./inter-500.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('./inter-600.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('./inter-700.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
CSSEOF

echo ""
echo "=== Done! ==="
echo ""
echo "MANUAL STEPS REQUIRED:"
echo ""
echo "1. Rename downloaded font files to match the CSS declarations:"
echo "   The downloaded files have Google's hash-based names."
echo "   Rename them to: heebo-400.woff2, heebo-500.woff2, etc."
echo "   You may need to inspect /tmp/heebo.css and /tmp/inter.css"
echo "   to map the unicode-range subsets to the correct weight files."
echo ""
echo "2. Update design-system.css (line 7):"
echo "   REPLACE:"
echo "     @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');"
echo "   WITH:"
echo "     @import url('../fonts/fonts.css');"
echo ""
echo "3. Update CSP headers in ALL HTML files:"
echo "   REMOVE from style-src: https://fonts.googleapis.com"
echo "   REMOVE from font-src: https://fonts.gstatic.com"
echo "   Files to update:"
echo "     - index.html"
echo "     - view-documents.html"
echo "     - document-manager.html"
echo "     - approve-confirm.html"
echo "     - admin/index.html"
echo "     - admin/questionnaire-mapping-editor.html"
echo "     - admin/document-types-viewer.html"
echo ""
echo "4. Test locally, then commit and push."
