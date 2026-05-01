# Mobile Chat Widget UX Research

**Date:** 2026-03-28
**Context:** Admin panel AI chat widget — Hebrew-first RTL app with existing bottom nav bar
**Sources:** 10+ articles from dev.to, HTMHell, MDN, Material Design, ishadeed.com, Medium, Intercom community, and design pattern libraries (2024-2026)

---

## 1. Full-Screen Mobile Chat Takeover

### Key Principles

- **100% viewport takeover is the standard.** WhatsApp, Telegram, Intercom, and all major chat apps use full-screen on mobile. No partial overlays, no half-sheets for active chat.
- **Chat input at the bottom.** Every major app places the input field at screen bottom, mirroring natural conversation flow. Studies show 40% faster response times with bottom-positioned inputs.
- **The launcher disappears.** When chat opens, the FAB/launcher hides. The chat IS the screen. Back/close returns to the previous view.

### Patterns to Use

```
CLOSED STATE:          OPEN STATE:
+----------------+     +----------------+
|   Admin Panel  |     | [X] AI Chat    |  <- sticky header with close
|                |     |----------------|
|   content...   |     | message bubble |
|                |     | message bubble |
|                |     | message bubble |
|                |     |                |
|   [bottom nav] |     | [input field]  |  <- replaces bottom nav
|          [FAB] |     +----------------+
+----------------+
```

- **Transition:** Slide-up from bottom (300ms ease-out) is the most natural pattern. Intercom uses this. Avoid fade-in (feels disconnected from the FAB origin).
- **Z-index:** Chat overlay must be above everything: bottom nav, FAB, any other overlays. Recommended: `z-index: 9999` or highest in your stack.
- **Height:** Use `100dvh` (not `100vh`) to avoid the mobile browser toolbar bug where content overflows.

### Anti-patterns

- **Partial overlays on mobile** — half-sheet chat panels that require scrolling inside a scrolling page. Confusing nested scroll contexts.
- **Keeping bottom nav visible** behind/under the chat — wastes space and creates tap-target conflicts.
- **Using `100vh`** — on mobile browsers, `100vh` includes the area behind the browser toolbar, causing the input to be clipped below the visible area.

---

## 2. Keyboard-Aware Input Handling

### The Problem

On mobile, the virtual keyboard covers ~40-50% of the screen. If the chat input is `position: fixed; bottom: 0`, the keyboard will cover it on many browsers (especially iOS Safari).

### Solution Hierarchy (best to worst)

#### A. `dvh` units + `interactive-widget` meta tag (RECOMMENDED)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content">
```

```css
.chat-container {
  height: 100dvh;
  display: flex;
  flex-direction: column;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
}
.chat-input {
  /* stays at bottom naturally via flexbox */
}
```

- `dvh` dynamically adjusts when keyboard appears/disappears
- `interactive-widget=resizes-content` tells the browser to resize the layout viewport when keyboard opens (Chrome 108+, Firefox 132+)
- **iOS Safari does NOT support `interactive-widget` yet** — but `dvh` alone works on iOS Safari

The three `interactive-widget` modes:
| Mode | Behavior |
|------|----------|
| `resizes-visual` (default) | Only visual viewport shrinks; layout viewport unchanged |
| `resizes-content` | Both viewports shrink; viewport units respond to keyboard |
| `overlays-content` | No resize; keyboard overlays content |

#### B. VirtualKeyboard API (Chrome Android only)

```javascript
if ("virtualKeyboard" in navigator) {
  navigator.virtualKeyboard.overlaysContent = true;
}
```

```css
.chat-input-wrapper {
  bottom: calc(1rem + env(keyboard-inset-height, 0rem));
}
```

- Provides `keyboard-inset-height` CSS env variable
- **Chrome Android only** — no Safari, no Firefox
- Good as progressive enhancement, not primary strategy

#### C. `visualViewport` API (fallback for older browsers)

```javascript
function adjustForKeyboard() {
  const vv = window.visualViewport;
  const offset = window.innerHeight - vv.height - vv.offsetTop;
  chatInput.style.transform = `translateY(-${offset}px)`;
}
window.visualViewport?.addEventListener('resize', adjustForKeyboard);
```

- Works on iOS 13+ and Android
- Requires JavaScript; adds complexity
- **The 2024-2025 consensus: prefer CSS-only (`dvh`) over this approach**

### Recommendation for Our App

Use approach A as primary. The CSS is minimal and works across modern iOS and Android:

```css
.ai-chat-overlay {
  position: fixed;
  inset: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  z-index: 9999;
}
```

---

## 3. FAB Positioning with Bottom Nav

### Material Design 3 Guidelines

- **FAB elevation:** Level 3 (highest standard component elevation, above bottom nav at Level 2)
- **FAB sizes:** Small (40dp), Standard (56dp), Large (96dp)
- **Minimum touch target:** 48x48dp regardless of visual size
- **Bottom App Bar integration:** FAB can be "cradled" (notched) into a bottom app bar, or float above it

### Coexistence Pattern

When both a bottom nav and FAB exist:

```
+---------------------------+
|                           |
|              [FAB 56dp]   |  <- floats 16dp above bottom nav
|                           |
| [nav] [nav] [nav] [nav]  |  <- bottom nav bar
+---------------------------+
```

- **Position FAB 16dp above the bottom nav bar** (standard Material spacing)
- FAB sits in bottom-right (LTR) or bottom-left (RTL) corner
- `position: fixed; bottom: calc(56px + 16px + env(safe-area-inset-bottom))` where 56px = nav height
- **Z-index:** FAB > bottom nav. FAB: `z-index: 1050`, bottom nav: `z-index: 1000`

### Anti-patterns

- **FAB overlapping nav items** — must have clear visual separation
- **Center FAB over bottom nav** — only appropriate when FAB IS the primary nav action (like Android BottomAppBar cradle pattern). Not for auxiliary features like chat.
- **FAB blocking content cards** — position to the side of scrollable content streams

---

## 4. Touch Interaction Patterns

### Swipe/Pull-to-Dismiss

- **Swipe-down to close chat** is expected on mobile (matches iOS sheet dismissal pattern and Android back gesture)
- Implementation: track `touchstart` Y, compare with `touchmove` Y. If delta > 100px downward and velocity is sufficient, animate close.
- **Do NOT require a specific close button only.** Users expect both: X button AND swipe-down gesture.

### Safe Area Handling (Notched Devices)

Required meta tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

CSS pattern for the chat container:
```css
.ai-chat-overlay {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* Chat input specifically needs bottom safe area */
.chat-input-wrapper {
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
```

- `env(safe-area-inset-bottom)` accounts for the home indicator bar on iPhones with no home button
- `env(safe-area-inset-top)` accounts for the notch/Dynamic Island
- Browser support: 96.78%
- **Always use `max()` with a minimum value** — `max(16px, env(safe-area-inset-bottom))` ensures comfortable spacing on both notched and non-notched devices

### FAB Safe Area

```css
.chat-fab {
  bottom: calc(56px + 16px + env(safe-area-inset-bottom, 0px));
  /* 56px nav + 16px gap + safe area */
}
```

---

## 5. RTL Considerations (Hebrew-First)

### Layout Mirroring Rules

**MUST mirror (directional elements):**
- FAB position: bottom-LEFT in RTL (not bottom-right)
- Chat header close button: RIGHT side in RTL (X button)
- Message bubbles: user messages LEFT-aligned (sender), bot messages RIGHT-aligned (receiver) -- mirrored from LTR
- Navigation flow: tabs read right-to-left
- Swipe gestures: swipe-right-to-go-back becomes swipe-left-to-go-back in RTL? NO -- swipe direction for dismiss should stay the same (swipe down), but horizontal navigation swipes reverse
- Back arrow icon: flipped horizontally

**MUST NOT mirror:**
- Checkmarks, play buttons, clock icons
- Numbers and phone numbers
- Brand logos
- Media playback controls

### CSS Implementation

```css
/* Use logical properties, not physical */
.chat-bubble-user {
  margin-inline-start: auto;  /* NOT margin-left */
  margin-inline-end: 8px;     /* NOT margin-right */
}

.chat-fab {
  inset-inline-end: 16px;     /* NOT right: 16px */
  /* In RTL, this becomes left: 16px automatically */
}

.chat-header-close {
  inset-inline-end: 12px;     /* X button on the "end" side */
}
```

- Use `dir="rtl"` on the chat container
- Use CSS logical properties throughout (`inline-start`/`inline-end`, `block-start`/`block-end`)
- Hebrew text alignment: `text-align: start` (resolves to `right` in RTL automatically)
- Mixed-language content (Hebrew + English technical terms): the browser's bidi algorithm handles this, but test thoroughly

### Chat-Specific RTL

- **User messages** (sent): appear on the LEFT side with a colored background (mirrored from LTR convention)
- **Bot/system messages** (received): appear on the RIGHT side
- **Timestamps:** Same side as the message bubble, below it
- **Input field placeholder:** Right-aligned, typed text flows RTL
- WhatsApp handles Hebrew RTL messaging well — use as reference

---

## Summary: Implementation Checklist

| Area | Action |
|------|--------|
| **Chat open** | Full-screen `100dvh` overlay, slide-up from FAB position, hide bottom nav |
| **Keyboard** | `interactive-widget=resizes-content` meta + `dvh` units + flexbox layout |
| **FAB position** | 16dp above bottom nav, `inset-inline-end` for RTL, include safe-area offset |
| **Z-index stack** | Bottom nav: 1000, FAB: 1050, Chat overlay: 9999 |
| **Safe areas** | `viewport-fit=cover` + `env(safe-area-inset-*)` with `max()` fallbacks |
| **Close gesture** | X button in header + swipe-down-to-dismiss |
| **RTL** | CSS logical properties everywhere, `dir="rtl"` on container, mirror FAB to left |
| **Input** | Bottom of chat via flexbox (not `position: fixed`), safe-area padding |

---

## Sources

- [Fix mobile keyboard overlap with VisualViewport](https://dev.to/franciscomoretti/fix-mobile-keyboard-overlap-with-visualviewport-3a4a) — dvh + interactive-widget approach
- [Control Viewport Resize Behavior with interactive-widget (HTMHell 2024)](https://www.htmhell.dev/adventcalendar/2024/4/) — Three interactive-widget modes explained
- [The Virtual Keyboard API (Ahmad Shadeed)](https://ishadeed.com/article/virtual-keyboard-api/) — VirtualKeyboard API + keyboard-inset-height CSS env
- [Fix mobile 100vh bug with dynamic viewport units](https://medium.com/@alekswebnet/fix-mobile-100vh-bug-in-one-line-of-css-dynamic-viewport-units-in-action-102231e2ed56) — dvh/svh/lvh comparison
- [CSS Safe Area Insets](https://theosoti.com/short/safe-area-inset/) — env() safe area patterns
- [RTL Mobile App Design for Arabic Users](https://www.milaajbrandset.com/blog/rtl-mobile-app-design-arabic-users/) — RTL navigation, gestures, tab bars
- [Material Design Bidirectionality](https://m2.material.io/design/usability/bidirectionality.html) — What to mirror vs not mirror
- [FAB - Material Design 3](https://m3.material.io/components/floating-action-button/overview) — FAB elevation, sizing
- [Bottom App Bar - Material Design 3](https://m3.material.io/components/bottom-app-bar/guidelines) — FAB + bottom bar integration
- [16 Chat UI Design Patterns 2025](https://bricxlabs.com/blogs/message-screen-ui-deisgn) — Input placement, bubble sizing
- [Intercom Mobile Positioning](https://community.intercom.com/messenger-8/is-there-a-way-to-adjust-the-position-of-the-messenger-on-mobile-devices-3026) — Intercom mobile launcher behavior
