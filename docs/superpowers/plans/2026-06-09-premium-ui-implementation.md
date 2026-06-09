# Intake Team Premium UI Implementation Plan (V3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement premium SaaS UI for Intake Team showing active receptionist working in real-time, with operational summaries, photo galleries, timelines, and urgency indicators.

**Architecture:** Build modular CSS design system first (variables, components), then implement each screen (Inbox, Incoming, Settings) with reusable components. Use Handlebars templates, CSS Grid for layout, HTMX for interactions. Emphasis on visual feedback that communicates active work.

**Tech Stack:** Fastify (existing), Handlebars (existing), HTMX, CSS3 (Grid, Flexbox, Variables), HTML5, TypeScript (services for summaries/urgency)

**Scope:** Full UI for 3 screens (Inbox, Incoming, Settings), design system, responsive layouts, premium aesthetic, no backend logic changes.

---

## File Structure

```
src/panel/
├── design/
│   ├── system.css              (Colors, typography, spacing, shadows, components)
│   ├── layout.css              (Sidebar, grid, responsive breakpoints)
│   ├── animations.css          (Transitions, wow moment sequence)
│   ├── inbox.css               (Inbox-specific styles)
│   ├── incoming.css            (Kanban-specific styles)
│   └── settings.css            (Settings-specific styles)
├── components/
│   ├── status-bar.ts           (Status bar + operational summary)
│   ├── sidebar.ts              (Navigation, logo, avatar)
│   ├── conversation-list.ts    (Grouped conversations)
│   ├── artifact-panel.ts       (Ficha inteligente: photos, timeline, actions)
│   ├── kanban.ts               (Pipeline view)
│   └── forms.ts                (Settings forms)
├── services/
│   ├── receptionist-summary.ts (Generate narrative summaries)
│   ├── urgency.ts              (Calculate urgency badges)
│   └── grouping.ts             (Group conversations by state)
├── routes/
│   ├── inbox.ts                (Update with V3 elements)
│   ├── incoming.ts             (Add urgency indicators)
│   └── settings.ts             (Apply styling)
├── templates/
│   ├── layouts/
│   │   └── base.handlebars     (Main layout with sidebar, status bar)
│   ├── inbox.handlebars        (Inbox view template)
│   ├── incoming.handlebars     (Incoming view template)
│   └── settings.handlebars     (Settings view template)
└── public/
    └── css/
        ├── design-system.css   (Built from src/design/system.css)
        ├── layout.css
        ├── animations.css
        ├── inbox.css
        ├── incoming.css
        └── settings.css
```

---

## Phase 1: Design System Foundation

### Task 1: Create Design System CSS — Variables & Colors

**Files:**
- Create: `src/panel/design/system.css`

- [ ] **Step 1: Write test file to validate CSS variables**

Create `src/panel/design/__tests__/system.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Design System', () => {
  let systemCSS: string;

  beforeAll(() => {
    systemCSS = readFileSync(resolve(__dirname, '../system.css'), 'utf-8');
  });

  it('should define all required color variables', () => {
    const requiredVars = [
      '--bg-primary',
      '--bg-secondary',
      '--text-primary',
      '--accent',
      '--accent-danger',
      '--accent-success',
      '--brand-primary',
      '--brand-secondary',
    ];

    requiredVars.forEach((variable) => {
      expect(systemCSS).toContain(`${variable}:`);
    });
  });

  it('should define typography scales', () => {
    expect(systemCSS).toContain('--font-size-');
    expect(systemCSS).toContain('--font-weight-');
  });

  it('should define spacing scale', () => {
    expect(systemCSS).toContain('--spacing-');
  });

  it('should define shadow utilities', () => {
    expect(systemCSS).toContain('--shadow-');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/panel/design/__tests__/system.test.ts
```

Expected: FAIL (system.css doesn't exist)

- [ ] **Step 3: Create design system CSS file**

Create `src/panel/design/system.css`:

```css
/* ============================================================================
   INTAKE TEAM — DESIGN SYSTEM V3
   Premium SaaS aesthetic inspired by Linear, Notion, Stripe, Intercom
   ========================================================================== */

:root {
  /* ─────────────────────────────────────────────────────────────────────
     ETHERION LABS BRAND COLORS
     ───────────────────────────────────────────────────────────────────── */
  --brand-primary: #2563eb;       /* Blue — trust, digital, tech */
  --brand-secondary: #0ea5e9;     /* Cyan — energy, innovation, AI */
  --brand-accent: #06b6d4;        /* Teal — precision, service */
  --brand-dark: #0a0e27;          /* Dark blue — premium, professional */

  /* ─────────────────────────────────────────────────────────────────────
     FUNCTIONAL COLORS
     ───────────────────────────────────────────────────────────────────── */
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-tertiary: #f0f2f5;
  --text-primary: #0a0e27;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;
  --border-color: #e5e7eb;
  --border-light: #f3f4f6;

  /* ─────────────────────────────────────────────────────────────────────
     SEMANTIC COLORS
     ───────────────────────────────────────────────────────────────────── */
  --accent: #2563eb;              /* Primary action */
  --accent-danger: #dc2626;       /* Urgent/overdue */
  --accent-success: #10b981;      /* Completed/approved */
  --accent-warning: #f59e0b;      /* Pending/in progress */
  --accent-info: #0ea5e9;         /* Information, active work */

  /* ─────────────────────────────────────────────────────────────────────
     TYPOGRAPHY
     ───────────────────────────────────────────────────────────────────── */
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
  --font-size-h1: 18px;
  --font-size-h2: 16px;
  --font-size-body: 13px;
  --font-size-small: 12px;
  --font-size-tiny: 11px;
  --font-size-input: 13px;

  --font-weight-light: 400;
  --font-weight-normal: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-tight: 1.2;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;

  /* ─────────────────────────────────────────────────────────────────────
     SPACING SCALE
     ───────────────────────────────────────────────────────────────────── */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 20px;
  --spacing-2xl: 24px;
  --spacing-3xl: 32px;
  --spacing-4xl: 40px;

  /* ─────────────────────────────────────────────────────────────────────
     SHADOWS
     ───────────────────────────────────────────────────────────────────── */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);

  /* ─────────────────────────────────────────────────────────────────────
     TRANSITIONS
     ───────────────────────────────────────────────────────────────────── */
  --transition-fast: all 0.15s ease;
  --transition-normal: all 0.2s ease;
  --transition-slow: all 0.3s ease;

  /* ─────────────────────────────────────────────────────────────────────
     BORDER RADIUS
     ───────────────────────────────────────────────────────────────────── */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}

/* ═════════════════════════════════════════════════════════════════════════
   BASE STYLES
   ═════════════════════════════════════════════════════════════════════════ */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  font-family: var(--font-family);
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: var(--line-height-normal);
}

/* ═════════════════════════════════════════════════════════════════════════
   COMPONENT CLASSES
   ═════════════════════════════════════════════════════════════════════════ */

/* Buttons */
.btn {
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  padding: var(--spacing-md) var(--spacing-lg);
  cursor: pointer;
  transition: var(--transition-normal);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-primary {
  background: linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-secondary) 100%);
  color: white;
  box-shadow: var(--shadow-sm);
}

.btn-primary:hover {
  box-shadow: var(--shadow-lg);
  opacity: 0.95;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 2px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-tertiary);
  border-color: var(--text-tertiary);
}

/* Inputs */
.input {
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: var(--transition-normal);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

/* Cards */
.card {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  transition: var(--transition-normal);
}

.card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--border-light);
}

/* Text utilities */
.text-primary {
  color: var(--text-primary);
}

.text-secondary {
  color: var(--text-secondary);
}

.text-tertiary {
  color: var(--text-tertiary);
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/panel/design/__tests__/system.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/design/system.css src/panel/design/__tests__/system.test.ts
git commit -m "feat(design): add design system CSS with colors, typography, spacing"
```

---

### Task 2: Create Layout CSS — Grid, Sidebar, Responsive

**Files:**
- Create: `src/panel/design/layout.css`

- [ ] **Step 1: Write test file for layout**

Create `src/panel/design/__tests__/layout.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Layout CSS', () => {
  let layoutCSS: string;

  beforeAll(() => {
    layoutCSS = readFileSync(resolve(__dirname, '../layout.css'), 'utf-8');
  });

  it('should define sidebar layout', () => {
    expect(layoutCSS).toContain('.sidebar');
    expect(layoutCSS).toContain('64px');
  });

  it('should define main grid layout', () => {
    expect(layoutCSS).toContain('.container');
    expect(layoutCSS).toContain('grid');
  });

  it('should define responsive breakpoints', () => {
    expect(layoutCSS).toContain('@media (max-width: 1200px)');
    expect(layoutCSS).toContain('@media (max-width: 768px)');
  });

  it('should define panel layouts', () => {
    expect(layoutCSS).toContain('.panel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/panel/design/__tests__/layout.test.ts
```

- [ ] **Step 3: Create layout CSS**

Create `src/panel/design/layout.css`:

```css
/* ============================================================================
   LAYOUT — Sidebar, Grid, Responsive
   ========================================================================== */

.container {
  display: grid;
  grid-template-columns: 64px 1fr;
  min-height: 100vh;
  background: var(--bg-secondary);
}

/* SIDEBAR */
.sidebar {
  background: var(--bg-primary);
  border-right: 1px solid var(--border-color);
  padding: var(--spacing-xl) 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-3xl);
  position: sticky;
  top: 0;
  height: 100vh;
  z-index: 100;
}

.sidebar-logo {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-secondary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: var(--font-weight-bold);
  font-size: 20px;
  cursor: pointer;
  transition: var(--transition-normal);
}

.sidebar-logo:hover {
  transform: scale(1.05);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.nav-item {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: var(--transition-normal);
  color: var(--text-secondary);
}

.nav-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--accent);
  color: white;
}

.sidebar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  align-items: center;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, #ec4899 0%, #f97316 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-weight-semibold);
  font-size: 14px;
  cursor: pointer;
}

/* MAIN CONTENT */
.main-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* STATUS BAR */
.status-bar {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  padding: var(--spacing-lg) var(--spacing-2xl);
  display: flex;
  align-items: center;
  gap: var(--spacing-2xl);
  flex-wrap: wrap;
}

.status-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-tiny);
}

.status-label {
  color: var(--text-tertiary);
  font-weight: var(--font-weight-semibold);
}

.status-value {
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-small);
}

.status-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-success);
  margin-right: var(--spacing-xs);
}

/* OPERATIONAL SUMMARY */
.operational-summary {
  padding: var(--spacing-lg) var(--spacing-2xl);
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(90deg, rgba(14, 165, 233, 0.05) 0%, transparent 100%);
  font-size: var(--font-size-body);
  font-style: italic;
  color: var(--text-secondary);
  line-height: var(--line-height-relaxed);
}

.operational-summary-text {
  margin-bottom: var(--spacing-sm);
}

.operational-summary-signature {
  text-align: right;
  color: var(--text-tertiary);
  font-size: var(--font-size-tiny);
  margin-top: var(--spacing-sm);
}

/* PAGE LAYOUT (Inbox, Incoming, etc.) */
.page-layout {
  display: grid;
  grid-template-columns: 360px 1fr 340px;
  gap: 0;
  flex: 1;
  overflow: hidden;
  background: var(--bg-secondary);
}

.panel {
  background: var(--bg-primary);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
}

.panel:last-child {
  border-right: none;
}

.panel-left {
  border-right: 1px solid var(--border-color);
}

.panel-center {
  border-right: 1px solid var(--border-color);
}

.panel-right {
  border-left: 1px solid var(--border-color);
}

/* PANEL HEADERS */
.panel-header {
  padding: var(--spacing-2xl);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.panel-title {
  font-size: var(--font-size-h1);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-lg);
}

.search-input {
  width: 100%;
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: var(--transition-normal);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-primary);
}

/* RESPONSIVE BREAKPOINTS */

/* Tablet: 768px - 1200px */
@media (max-width: 1200px) {
  .page-layout {
    grid-template-columns: 300px 1fr;
  }

  .panel-right {
    display: none;
  }
}

/* Mobile: <768px */
@media (max-width: 768px) {
  .container {
    grid-template-columns: 1fr;
  }

  .sidebar {
    flex-direction: row;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    padding: var(--spacing-md) var(--spacing-lg);
    gap: var(--spacing-lg);
  }

  .sidebar-bottom {
    margin-left: auto;
    margin-top: 0;
    flex-direction: row;
  }

  .page-layout {
    grid-template-columns: 1fr;
  }

  .panel-left,
  .panel-right {
    border: none;
  }

  .panel-right {
    display: none;
  }

  .status-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-md);
  }

  .operational-summary {
    padding: var(--spacing-lg);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/panel/design/__tests__/layout.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/panel/design/layout.css src/panel/design/__tests__/layout.test.ts
git commit -m "feat(design): add layout CSS with sidebar, grid, responsive breakpoints"
```

---

### Task 3: Create Animations CSS

**Files:**
- Create: `src/panel/design/animations.css`

- [ ] **Step 1: Create animations CSS**

Create `src/panel/design/animations.css`:

```css
/* ============================================================================
   ANIMATIONS — Wow moment, transitions, feedback
   ========================================================================== */

/* Pulse animation for "Receptionist Working" indicator */
@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
  100% {
    opacity: 1;
  }
}

.receptionist-working {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Slide in animation for artifact panel (wow moment) */
@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(100px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.artifact-panel {
  animation: slideInRight 0.3s ease-out;
}

/* Fade in for operational summary */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.operational-summary {
  animation: fadeIn 0.5s ease-out;
}

/* Timeline cards slide in */
@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.timeline-item {
  animation: slideInLeft 0.3s ease-out;
}

/* Progress bar fill animation */
@keyframes fillProgress {
  from {
    width: 0;
  }
}

.progress-fill {
  animation: fillProgress 0.5s ease-out;
}

/* Scale on hover (cards) */
@keyframes scaleUp {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.02);
  }
}

.card:hover {
  animation: scaleUp 0.2s ease-out forwards;
}

/* Subtle shimmer for loading states */
@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

.loading {
  background: linear-gradient(
    90deg,
    var(--bg-tertiary) 25%,
    var(--bg-secondary) 50%,
    var(--bg-tertiary) 75%
  );
  background-size: 1000px 100%;
  animation: shimmer 2s infinite;
}

/* Wow moment sequence */
.wow-moment {
  display: contents;
}

/* Phase 1: Artifact slides in */
.wow-moment .artifact-panel {
  animation: slideInRight 0.3s ease-out 0s;
}

/* Phase 2: Working indicator pulses (after 1s) */
.wow-moment .receptionist-working {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite 1s;
}

/* Phase 3: Operational summary fades in (after 2s) */
.wow-moment .operational-summary {
  animation: fadeIn 0.5s ease-out 2s backwards;
}

/* Phase 4: Timeline items populate (after 3s) */
.wow-moment .timeline-item:nth-child(1) {
  animation: slideInLeft 0.3s ease-out 3s backwards;
}

.wow-moment .timeline-item:nth-child(2) {
  animation: slideInLeft 0.3s ease-out 3.15s backwards;
}

.wow-moment .timeline-item:nth-child(3) {
  animation: slideInLeft 0.3s ease-out 3.3s backwards;
}

/* Transition utilities */
.transition-fast {
  transition: var(--transition-fast);
}

.transition-normal {
  transition: var(--transition-normal);
}

.transition-slow {
  transition: var(--transition-slow);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/panel/design/animations.css
git commit -m "feat(design): add animations CSS for wow moment and transitions"
```

---

## Phase 2: Sidebar & Status Bar Components

[Due to length constraints, I'll continue with key remaining tasks in condensed form...]

### Task 4: Implement Sidebar Component

**Files:**
- Modify: `src/panel/routes/inbox.ts`, `src/panel/routes/incoming.ts`, `src/panel/routes/settings.ts`
- Create: `src/panel/templates/layouts/base.handlebars`

- [ ] **Step 1-5:** Implement sidebar in base layout template with navigation items, responsive behavior, active states. Tests for nav item rendering. Commit.

---

### Task 5: Implement Status Bar + Operational Summary

**Files:**
- Create: `src/panel/services/receptionist-summary.ts`
- Modify: `src/panel/routes/inbox.ts`

- [ ] **Step 1:** Create `receptionist-summary.ts` service:
  - Function `generateSummary(actions: Action[]): string`
  - Generates narrative like "Just asked 3 clients for photos. María sent the budget."
  - Returns formatted summary + signature

- [ ] **Step 2-3:** Test service with mock actions

- [ ] **Step 4:** Integrate into inbox route, pass to template

- [ ] **Step 5:** Template renders status bar + operational summary HTML

- [ ] **Step 6:** Apply CSS styles, test responsive, commit

---

## Phase 3: Inbox Screen — Conversation List

### Task 6: Implement Conversation Grouping & List

**Files:**
- Create: `src/panel/services/grouping.ts`
- Modify: `src/panel/templates/inbox.handlebars`
- Create: `src/panel/design/inbox.css`

- [ ] **Step 1:** Create grouping service:
  ```typescript
  export function groupConversationsByState(conversations: Conversation[]): GroupedConversations {
    return {
      attentionRequired: [...],
      waitingClient: [...],
      inAttention: [...],
    };
  }
  ```

- [ ] **Step 2-3:** Test grouping logic, commit

- [ ] **Step 4:** Update inbox template to render grouped sections with collapse/expand

- [ ] **Step 5:** Create inbox.css with conversation card styles, hover states, animations

- [ ] **Step 6:** Test visual rendering, responsive, commit

---

## Phase 4: Artifact Panel — The Hero Element

### Task 7: Implement Artifact Panel Header & Branding

**Files:**
- Modify: `src/panel/templates/inbox.handlebars`
- Modify: `src/panel/design/inbox.css`

- [ ] **Step 1:** Add artifact header template (vehicle, client, phone) with brand styling

- [ ] **Step 2-3:** CSS for header (gradient background, brand colors, font hierarchy)

- [ ] **Step 4-5:** Test rendering, commit

---

### Task 8: Implement Photo Gallery

**Files:**
- Modify: `src/panel/templates/inbox.handlebars`
- Modify: `src/panel/design/inbox.css`

- [ ] **Step 1:** Template: Photo gallery section with thumbnail grid (4 columns, 80x80px)

- [ ] **Step 2:** CSS: Grid layout, hover effects, border-radius, transitions

- [ ] **Step 3:** Handle empty state (placeholder icon if no photos)

- [ ] **Step 4:** Test with sample images, commit

---

### Task 9: Implement Action Timeline

**Files:**
- Create: `src/panel/services/timeline.ts`
- Modify: `src/panel/templates/inbox.handlebars`
- Modify: `src/panel/design/inbox.css`

- [ ] **Step 1:** Service to format agent actions into timeline items

- [ ] **Step 2-3:** Test timeline formatting

- [ ] **Step 4:** Template: Timeline section with vertically stacked items (icon, time, action, detail)

- [ ] **Step 5:** CSS: Timeline styling (icons, colors, indentation, animations)

- [ ] **Step 6:** Test, commit

---

### Task 10: Implement Working Indicator + Progress Bar

**Files:**
- Modify: `src/panel/templates/inbox.handlebars`
- Modify: `src/panel/design/inbox.css`

- [ ] **Step 1:** Template: "Receptionist Working" indicator (top-right artifact header) with pulsing icon

- [ ] **Step 2:** Template: Progress bar section with animated fill, fraction, percentage

- [ ] **Step 3:** CSS: Pulsing animation, progress bar gradient, text alignment

- [ ] **Step 4:** Test animations, commit

---

### Task 11: Implement Artifact Action Buttons

**Files:**
- Modify: `src/panel/templates/inbox.handlebars`
- Modify: `src/panel/design/inbox.css`

- [ ] **Step 1:** Template: 4 buttons (Approve, Request Photos, Transfer, Pause) full-width, uppercase

- [ ] **Step 2:** CSS: Button styling (primary gradient, secondary, large padding, uppercase)

- [ ] **Step 3:** Test hover states, responsive, commit

---

## Phase 5: Incoming Screen — Kanban Pipeline

### Task 12: Implement Urgency Calculation Service

**Files:**
- Create: `src/panel/services/urgency.ts`

- [ ] **Step 1:** Service to calculate urgency badge based on time pending:
  ```typescript
  export function getUrgencyBadge(createdAt: Date): UrgencyBadge {
    const hours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hours > 24) return { icon: '🔴', label: 'URGENTE', color: 'danger' };
    if (hours > 6) return { icon: '🟠', label: 'PENDIENTE', color: 'warning' };
    return { icon: '⏳', label: `${Math.round(hours)}h`, color: 'tertiary' };
  }
  ```

- [ ] **Step 2-3:** Test various time scenarios, commit

---

### Task 13: Implement Kanban View

**Files:**
- Modify: `src/panel/templates/incoming.handlebars`
- Create: `src/panel/design/incoming.css`

- [ ] **Step 1:** Template: Kanban columns (6 columns: Intake incompleto, Listo para revisión, etc.)

- [ ] **Step 2:** Template: Kanban cards with vehicle, client, work type, meta (photos, urgency, time)

- [ ] **Step 3:** CSS: Column styling, card layout, hover effects, urgency badge colors

- [ ] **Step 4:** CSS: Grid horizontal scroll, card animations

- [ ] **Step 5:** Test rendering, responsive, commit

---

## Phase 6: Settings Screen

### Task 14: Implement Settings Forms

**Files:**
- Modify: `src/panel/templates/settings.handlebars`
- Create: `src/panel/design/settings.css`

- [ ] **Step 1:** Template: Settings form (Horario, Datos a Capturar, Automatizaciones) with checkboxes

- [ ] **Step 2:** CSS: Form styling (sections, labels, checkboxes, dividers)

- [ ] **Step 3:** Test rendering, accessibility, commit

---

## Phase 7: Styling & Polish

### Task 15: Apply Design System to All Templates

- [ ] Link CSS files to base layout in correct order
- [ ] Test all screens for color consistency
- [ ] Verify all buttons, inputs, cards use design system
- [ ] Check shadow, spacing, typography across all pages

---

### Task 16: Implement Responsive Design

- [ ] Test desktop view (full 3-column)
- [ ] Test tablet view (2-column, no artifact)
- [ ] Test mobile view (stacked, single column)
- [ ] Test touch interactions
- [ ] Verify sidebar responsive (horizontal on mobile)

---

### Task 17: Final Verification & Polish

- [ ] Test all animations (wow moment sequence, pulsing, transitions)
- [ ] Verify brand colors present and consistent
- [ ] Check accessibility (color contrast, keyboard nav)
- [ ] Performance check (CSS optimized, no layout thrashing)
- [ ] Final commit

---

## Success Criteria

✅ All 3 screens (Inbox, Incoming, Settings) render with V3 design  
✅ Design system CSS is comprehensive and reusable  
✅ Responsive layouts work on desktop, tablet, mobile  
✅ Animations smooth (no jank, proper timing)  
✅ Artifact panel is visually prominent (hero element)  
✅ Operational summary shows narrative + updates  
✅ Photo gallery displays thumbnails  
✅ Timeline shows action history  
✅ Working indicator pulses when active  
✅ Progress bar animates  
✅ Kanban shows urgency indicators  
✅ Brand colors (Etherion Labs blue/cyan) present throughout  
✅ All text readable (contrast, font size)  
✅ Buttons, inputs, forms styled consistently  
✅ Wow moment animation sequence works on load  

---

## Next Steps After Implementation

1. **Integration Testing:** Test with real data from backend
2. **Dark Mode (Phase 2):** Add dark mode CSS variants
3. **HTMX Interactivity (Phase 2):** Add real interactions (swap groups, load more, etc.)
4. **Animations Polish (Phase 2):** Fine-tune timing, add more feedback
5. **Performance Optimization:** Minify CSS, optimize critical path
6. **User Testing:** Get feedback from pilot customers

---

**Plan saved and ready for execution.**

