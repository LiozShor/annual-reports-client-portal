# DL-191: Remove "Delete & Start Over" Button from Client Portal

**Status:** Done
**Date:** 2026-03-26
**Scope:** Client Portal — Landing Page

## Problem

The "מחק והתחל מההתחלה / Delete & Start Over" button was visible to clients on the landing page in production. This button allows clients to delete all their documents and restart the questionnaire — too destructive for production use.

## Solution

Removed the button and all associated code:

### Files Changed

1. **`assets/js/landing.js`**
   - Removed the `<button id="resetBtn">` from `showExistingSubmission()` template
   - Removed `RESET_ENDPOINT` constant
   - Removed `confirmReset()`, `closeResetModal()`, `resetAndContinue()` functions
   - Removed reset modal backdrop click listener
   - Removed `_resetLocked` double-submit guard
   - Removed unused translation keys: `btn_reset`, `reset_loading`, `reset_done`, `err_reset`

2. **`index.html`**
   - Removed the `#resetModal` confirmation dialog HTML

### What Still Works

- "View Required Documents" button unchanged
- Language selection flow unchanged
- All other landing page functionality intact

## Commit

`3848342` — `feat(client-portal): remove Delete & Start Over button from landing page`
