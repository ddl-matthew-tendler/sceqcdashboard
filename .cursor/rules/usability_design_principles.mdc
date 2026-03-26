# Domino Design System Guidelines

> Source: [Domino Design System Guidelines Wiki](https://dominodatalab.atlassian.net/wiki/spaces/PDT/pages/2997682182/Design+system+guidelines)

Guidelines for designers, developers, and product managers to create consistent, user-friendly interfaces aligned with Domino's vision.

## Core Design Philosophy

- Follow **atomic design methodology**
- Use **Ant Design** as the base component library
- Refer to [Domino Storybook](https://main--60c0de3f60dd96003bdcb1a1.chromatic.com/?path=/docs/getting-started-introduction--docs) for components

---

# Domino's UX Principles

## 1. Pave a Smooth Path

**Support users through an opinionated experience that helps them achieve their goals directly.**

- Don't drop users into the platform without orientation
- If a task is easier to complete with the Domino UI, don't force users to use the API or terminal
- Lean on the API experience intentionally rather than as a replacement for creating its UI counterpart
- Give guidance on next steps; don't leave users at dead ends
- Organize tools around user goals and workflows so the path is obvious
- Explain concepts in-page with tooltips, popovers, and descriptions
- Anticipate that not all users will know how and when to use Domino's tools

## 2. Increase User Confidence

**Communicate transparently and implement consistent patterns.**

- Write detailed error messages with reasons and resolution steps
- Explain disabled states: why disabled and how to enable
- Give feedback through micro-animations or status messages
- Use correct grammar and spelling
- Use consistent design language, terms, and components

## 3. Reduce Effort to Value

**Automate steps and reduce cognitive load.**

- Present only necessary information for each step
- Use progressive disclosure for advanced/optional features
- Automate steps that have low value compared to user effort
- Default configurations and settings based on what we know about the user, and make them easy to edit
- Present information when applicable, not all at once

## 4. Adapt to Repeat Users

**Design for the repeat, intermediate user—not perpetual beginners.**

- Use "Onboarding" then "Sideboarding" approach for new features
- Onboard users, not the project — make content dynamic to first-time vs. returning users since projects may have multiple collaborators
- Allow users to opt out of repeated warnings: "Don't show me this again"
- Support keyboard shortcuts for repeat actions
- Let help text fade after first exposure to reduce noise

---

# UX Design Checklist

Use when designing and reviewing UI:

### Core Experience
- [ ] Is it clear what the user should do at each step?
- [ ] Are choices easy to understand with explanations if needed?
- [ ] Does the solution consider how users can achieve their goals proactively and reactively?
- [ ] Did you consider the inputs the user needs and the output each step will generate?

### States & Feedback
- [ ] Are there designs and copy for unsuccessful states (errors)?
- [ ] Are empty states **actionable** (explaining what, why, and what to do)?
- [ ] Do error messages distinguish system errors (human-readable) from user code output (show raw)?

### Layout & Responsiveness
- [ ] Is layout checked on laptop and wide monitor sizes?
- [ ] Do side panels **overlay** rather than crush main content?
- [ ] In content panels with mixed elements, is spacing used to create visual groups (tight within groups, loose between groups)?
- [ ] Are tables given adequate space, not crushed by adjacent panels?

### Tables & Data
- [ ] Do truncated cells have tooltips showing full content?
- [ ] Can users distinguish rows without clicking each one?

### Interactive Elements
- [ ] Do icon-only buttons have tooltips?
- [ ] Are disabled elements explained (why disabled, how to enable)?

### Forms & Configuration
- [ ] Does the form require excessive scrolling? Are optional sections collapsible?
- [ ] Do empty code editors have placeholder examples or guidance?
- [ ] Are optional sections clearly marked? Do collapsed sections show summaries?

### Copy & Accessibility
- [ ] Is copy checked for grammar and Domino term capitalization (Workspace, Model API, Artifacts)?
- [ ] Are colors, fonts, and interactions accessible?
- [ ] Are the terms and language used understandable to a non-data scientist?

### Quality
- [ ] Did you try to break the product while QA'ing?

---

# Design System Structure

## UX Principles & Styling

### General
- **Lovable Domino** – Guidelines for delightful user experiences
- **Domino's UX Principles** – Core principles (detailed above)
- **3rd Party Integration UX Guide** – Guidelines for integrating third-party tools
- **UX Writing** – Guidelines for UI copy and content
- **This or That?** – Quick guide for common UI usage questions

### Foundations
- **Typography** – Font styles, sizes, and hierarchy
- **Colors** – Color palette and usage guidelines
- **Icons** – Icon library and usage guidelines
- **Spacing** – Spacing system and layout guidelines
- **Elevation** – Shadow and depth guidelines

---

# Color Tokens

Domino's core color tokens. Use these exact values when implementing or reviewing UI elements.

## Text

| Token | Hex | Usage |
|-------|-----|-------|
| **Text / Heading** | `#3F4547` | Headings, labels, primary text |
| **Text / Body** | `#7F8385` | Body copy, descriptions, secondary text |

## Interactive / Buttons

| Token | Hex | Usage |
|-------|-----|-------|
| **Primary Blue** | `#3B3BD3` | Primary button fill, tertiary/link text, active interactive elements (radio buttons, checkboxes, toggles) |
| **On Primary** | `#FFFFFF` | Text and icons on primary blue backgrounds |
| **Secondary Surface** | `#EDECFB` | Secondary button background |
| **Secondary Border** | `#C9C5F2` | Secondary button border |
| **Secondary Text** | `#1820A0` | Secondary button text, darker blue for emphasis |

## Containers & Dividers

| Token | Hex | Usage |
|-------|-----|-------|
| **Container Border** | `#DBE4E8` | Card borders, section dividers, input field borders |

## Button Color Application

| Button Type | Background | Border | Text |
|-------------|-----------|--------|------|
| **Primary** | `#3B3BD3` (Primary Blue) | — | `#FFFFFF` (On Primary) |
| **Secondary** | `#EDECFB` (Secondary Surface) | `#C9C5F2` (Secondary Border) | `#1820A0` (Secondary Text) |
| **Tertiary** | transparent | — | `#3B3BD3` (Primary Blue) |
| **Link** | transparent | — | `#3B3BD3` (Primary Blue) |

---

# UX Writing Guidelines

> Source: [UX Writing Wiki](https://dominodatalab.atlassian.net/wiki/spaces/PDT/pages/3056599056/UX+writing)

## General Principles

- **Be concise** – Remove unnecessary words
- **Avoid ambiguity** – Users should immediately understand
- **Write in active voice** – "Save changes" not "Changes can be saved"
- **Use familiar words** – Avoid jargon and technical terms unless necessary
- **Guide users, don't just inform** – Offer next steps, not just facts
- **Maintain consistency** – Use the same terms for actions, objects, and features across the product

## Style Guide

### Capitalization
- Default to **sentence case**: "Filter by date" not "Filter by Date"
- Exceptions: Domino terms (Workspace, Model API, Artifacts) and user-created entities (maintain casing as entered)

### Page Titles
- Use concise patterns: "Edit [Entity]" not "Edit the definition of [Entity]"
- **Good:** "Edit pytorch env" | **Bad:** "Edit the definition of pytorch env"

### Punctuation
- No exclamation points
- Use contractions for conversational tone
- Ampersands (&) only in space-constrained UI

### Numbers & Dates
- Use numerals: "3%" not "three percent"
- Use "fewer than" for countable items, "less than" for measurements
  - **Good:** "fewer than 10 files" and "less than 5GB of storage"
- Date format: "Month Day, Year" (February 25, 2025)
- Relative dates ("2 days ago") only within 7 days

## Errors & Status Messages

**First and foremost, prevent user errors when possible** – If you're adding an error message, explore ways to prevent the error from occurring at all.

### If you must include an error message:
- Be direct, concise, and speak directly to the user
- Provide actions to resolve when possible
- Avoid adding unnecessary or unactionable anxiety
- Avoid unnecessary apologies or warnings about unlikely issues

### Examples:

| Good | Bad |
|------|-----|
| "Unable to allocate resources to run your workspace. Try again in a few minutes, or contact your admin to increase available resources." | "The workspace most likely seems to have failed to get properly assigned compute resources at this time." |
| "Average response time: 650ms" | "Average response time: 650ms. WARNING: due to sampling and/or rounding as well as mathematical outliers, this may not represent the experience of all user transactions." |

## Accessibility & Inclusivity

- Write for screen readers (avoid "read more," use descriptive links)
- Avoid culturally specific idioms or slang
- Use gender-neutral language

## Word Catalog

| Word | Usage |
|------|-------|
| **Add** | Entity exists, being added to something (e.g., adding user to Project). Don't say "add new". |
| **Create** | Entity doesn't exist yet (e.g., creating a user profile). Don't say "create new". |
| **Performance** | Metrics relating to deployment integrity (e.g., model quality, data drift). |
| **System health** | Metrics relating to system-level behavior (e.g., CPU/GPU/memory, latency, error rate). |
| **Usage** | Metrics relating to consumer usage of a deployment (e.g., Apps views). |

---

# General Usability Best Practices

## Fitts's Law

The time to acquire a target depends on distance and size. Larger, closer targets are faster to click.

### Key Principles
- **Make targets large enough** – Min 24×24px desktop, 44×44px touch
- **Reduce distance to frequent actions** – Place controls near user's focus
- **Utilize screen edges** – Elements at edges are easier to target (cursor stops naturally)
- **Group related actions** – Reduces distance between sequential actions

### Common Mistakes
- Tiny touch targets (especially icon-only buttons)
- Insufficient padding around clickable elements
- Scattering related buttons across the screen
- Placing actions far from where users are focused
- **Small icons in far corners** – e.g., tiny icons in top-right while user focuses on left-side input. Violates both size AND distance principles.

### Anti-Pattern Example: Container Action Icons
```
❌ Bad: Icons are tiny AND maximally distant from focus
┌────────────────────────────────────────────────┐
│ What is the purpose of the model?    [💬2][📎0] │
│ ┌────────────────────────────────────────────┐ │
│ │ User types here (focus area)               │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘

✅ Better: Increase target size, or show on hover, or position near related content
```

---

## UI Screens Should Have a Clear Call to Action

Every screen, modal, or form should have **one clear primary action** that is visually dominant. Use the Domino button types to establish visual hierarchy. See the [Button component guidelines](https://main--60c0de3f60dd96003bdcb1a1.chromatic.com/?path=/docs/components-actions-button--docs) in Storybook.

### Button Types & Visual Hierarchy

Domino buttons come in four types, each with decreasing visual weight:

| Type | Style | Use For |
|------|-------|---------|
| **Primary** | Solid filled (`#3B3BD3` Primary Blue background, `#FFFFFF` white text) | The single main action on a screen — "Create data source", "Save changes", "Launch workspace" |
| **Secondary** | `#EDECFB` background, `#C9C5F2` border, `#1820A0` text | Important but non-primary actions — "Cancel", "Export", "Duplicate" |
| **Tertiary** | Text-only (`#3B3BD3` Primary Blue text, no border or background) | Lower-emphasis actions — "Reset", "Clear filters", inline actions |
| **Link** | Link-styled text (`#3B3BD3` Primary Blue, no border or background) | Navigation-style actions — "View documentation", "Learn more" |

### One Primary Button Per View

- **Only one Primary button should appear per screen, modal, or form.** Multiple primary buttons compete for attention and eliminate the visual hierarchy.
- All other actions should use Secondary, Tertiary, or Link styles based on their relative importance.

### Common Patterns

| Context | Primary | Secondary/Other |
|---------|---------|-----------------|
| **Modal/Form** | "Create data source" (solid filled) | "Cancel" (secondary outlined) |
| **Confirmation dialog** | "Delete project" (solid filled, destructive color) | "Cancel" (secondary outlined) |
| **Page header** | "Create project" (solid filled) | "Import" (secondary), "Filter" (tertiary) |
| **Wizard/Stepper** | "Next" / "Finish" (solid filled) | "Back" (secondary), "Cancel" (tertiary/link) |

### Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Two Primary buttons side by side** | No clear hierarchy — user hesitates | Demote the less important action to Secondary |
| **Primary button styled as Secondary** | Main action doesn't stand out; user may miss it | Use solid filled Primary for the main CTA |
| **All buttons same style** | Flat hierarchy — everything looks equally important | Apply the type hierarchy: one Primary, others Secondary/Tertiary |
| **Cancel styled as Primary** | Destructive/dismissive action competes with the intended action | Cancel should always be Secondary or Tertiary |

---

## Visual Hierarchy & Layout

### Reading Patterns

**F-Pattern** (text-heavy pages): Users scan top horizontal, then down the left side.
- Place key info along top and left

**Z-Pattern** (minimal text pages): Eyes move top-left → top-right → bottom-left → bottom-right.
- Place primary CTA at bottom-right

### Establishing Hierarchy

1. **Size** – Larger elements draw attention first
2. **Color & Contrast** – High contrast stands out
3. **Position** – Top-left scanned first (LTR languages)
4. **Whitespace** – Isolated elements appear more important
5. **Typography weight** – Bold draws more attention

---

## Typography

### Type Scale (base 16px, ratio 1.25)

| Level | Size | Use |
|-------|------|-----|
| H1 | 32px | Page titles |
| H2 | 26px | Section headers |
| H3 | 20px | Subsection headers |
| H4 | 16px | Card titles, labels |
| Body | 14-16px | Primary content |
| Caption | 12px | Helper text, metadata |
| Small | 11px | Fine print, timestamps |

### Heading Hierarchy Rules
- Don't skip heading levels (H1 → H2 → H3)
- One H1 per page
- Headings should describe content for scannability
- Same heading level = same visual treatment everywhere

### Weight & Style

| Weight | Use For |
|--------|---------|
| **Bold (600-700)** | Headings, labels, emphasis, important numbers |
| **Medium (500)** | Subheadings, navigation items, button text |
| **Regular (400)** | Body text, descriptions, form inputs |
| **Light (300)** | Large display text only (not for small sizes) |

### Creating Hierarchy Without Changing Size

- **Weight contrast** – Bold label + regular value
- **Color contrast** – Primary color for key info, muted gray for secondary
- **Case** – ALL CAPS for small labels (sparingly), sentence case for content
- **Style** – Italic for emphasis or metadata (use sparingly)

### Line Height (Leading)

| Text Type | Line Height |
|-----------|-------------|
| Headings | 1.1 – 1.3 (tighter) |
| Body text | 1.4 – 1.6 (comfortable reading) |
| Captions | 1.3 – 1.4 |

### Rules
- Minimum 14px for body text, 16px preferred
- Left-align body text (not centered)
- Aim for 50-75 characters per line
- Avoid light-weight fonts at small sizes

### Typography for Data

| Element | Recommendation |
|---------|----------------|
| Numbers in tables | Tabular/monospace figures |
| Large numbers | Thousand separators (1,234,567) |
| Units | Smaller or lighter weight than the number |
| Trends (+/-) | Use color + icon, not just symbols |
| Empty/null values | "—" or "N/A", not "0" or blank |

---

## Whitespace, Grouping & Visual Clustering

### Law of Proximity (Gestalt Principle)
**Elements close together are perceived as related.** Use whitespace and font hierarchy together to create clear visual groups.

### Why This Matters
When all elements are equally spaced, the UI becomes a visual mess:
- Users can't tell which items belong together
- Related content appears disconnected
- The interface feels like a flat list rather than organized information
- Cognitive load increases as users must manually parse relationships

### The 1:2 Ratio Rule
- Space **within** a group ≈ **half** the space **between** groups
- This creates clear visual separation without explicit borders

### Guidelines
- **Group related controls together** – Form fields that belong together should be visually clustered
- **Separate unrelated sections** – Use more whitespace between distinct sections than within sections
- **Consistent spacing scale** – Use a spacing system (e.g., 4px, 8px, 16px, 24px, 32px)
- **Use cards** to group related content and create clear boundaries
- **Use section dividers** – Subtle lines or background colors to separate major sections
- **Combine whitespace with font hierarchy** – Use heading weight and size to reinforce grouping (e.g., bold section header with tighter-spaced fields below, then a larger gap before the next section)

### Where This Applies (and Doesn't)

**DO apply differential spacing to:** Content panels with mixed element types, forms with labels/inputs/helper text, cards with multiple related elements, detail panels with varying sections

**DO NOT apply to:** Data tables (uniform row spacing is correct), homogeneous lists, navigation menus

The key distinction: **Uniform spacing is correct for homogeneous, repeating items** (like table rows). **Differential spacing is needed when grouping heterogeneous elements** (like a file header + content + comment area).

### Common Spacing Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Uniform spacing in content panels** | Mixed elements all look unrelated | Tight within groups, loose between groups |
| **No visual clustering** | Can't tell which comment belongs to which file | Reduce space within related items, increase space between categories |
| **Flat list of mixed content** | Headers, content, and actions blend together | Use indentation, background colors, or cards |
| **Orphaned labels** | Labels equidistant from multiple elements | Place labels closer to their associated content |

### Example: File Sections with Comments

❌ **Bad:** Equal 16px spacing between everything
```
results/stderr.txt          ← 16px gap
Add a comment...            ← 16px gap  
No Comments                 ← 16px gap
results/stdout.txt          ← 16px gap
Add a comment...            ← User can't tell which comment area belongs to which file
```

✅ **Good:** Tight spacing within groups, larger gaps between groups
```
results/stderr.txt          ← 8px gap (tight, belongs together)
  Add a comment...          ← 4px gap
  No Comments               
                            ← 24px gap (clearly separates file sections)
results/stdout.txt          
  Add a comment...          
  No Comments
```

---

## Alignment

### Principles
- **Align elements to a grid** – Creates visual order and professionalism
- **Left-align text** in LTR languages for readability (avoid centered body text)
- **Align form labels consistently** – Either all left-aligned or all right-aligned
- **Align related data in tables** – Numbers right-aligned, text left-aligned
- **Align action buttons** – Consistent placement across similar views (e.g., always bottom-right for modals)

### Common Alignment Patterns
- **Form labels**: Left-aligned labels above fields, or right-aligned labels beside fields
- **Modal actions**: Primary action on the right, secondary (Cancel) on the left
- **Page actions**: Primary actions in top-right or prominent position

---

## Calls to Action (CTAs)

### Button Labeling

| Bad | Good | Why |
|-----|------|-----|
| "OK" | "Save changes" | Specific |
| "Submit" | "Create project" | Names action and object |
| "Click here" | "View documentation" | Descriptive, accessible |
| "Delete" | "Delete project" | Includes the object |
| "Yes" / "No" | "Delete" / "Keep" | Action-oriented |

### Guidelines
- **Start with a verb** – "Save", "Delete", "Export"
- **Be specific** – "Delete project" not just "Delete"
- **Match the trigger** – "Edit profile" → "Save profile"
- **Avoid jargon** – "Submit" is vague; prefer specific actions

### Disable vs. Hide

| Approach | When to Use |
|----------|-------------|
| **Disable** | Action exists but not available yet; include tooltip explaining why |
| **Hide** | User will never need this action (e.g., admin-only for regular users) |
| **Show with explanation** | Action unavailable with a reason (tooltip or helper text explaining why) |

- Disabled buttons should have a tooltip explaining why they're disabled
- Don't hide actions and then show them unexpectedly — users should understand what's possible

---

## Detail Panels: Drawers vs. Modals

### The Problem with Push-Based Side Panels

When a side panel **pushes** content (compresses it horizontally), it can:
- Crush table columns, making data unreadable
- Force awkward horizontal scrolling
- Break responsive layouts

| Pattern | Best For | Considerations |
|---------|----------|----------------|
| **Overlay Side Drawer** | Quick previews, detail views (doesn't compress main content) | Main content remains visible but dimmed |
| **Push Side Panel** | Persistent context needed; ensure minimum widths | Risk of crushing main content |
| **Modal Dialog** | Focused tasks, confirmations | Can't reference main content easily |
| **Full-Page Navigation** | Complex detail views; use breadcrumbs | Clear context switch |

### Recommendations
1. **Prefer overlay drawers** for table row details — main content stays at full width
2. **Set minimum widths** if using push panels — tables should never compress below readable widths
3. **Consider data density** — if the table has many columns, overlay is strongly preferred; if detail view is complex, consider full-page navigation

### Implementation Notes
- Overlay drawers should have a backdrop that closes the drawer when clicked
- Include a clear close button (X) in the drawer header
- Support keyboard navigation (Escape to close)
- Animate smoothly (slide in from right)

---

## Table Design

### Truncated Text Requirements
- **Tooltip on hover** showing full text
- **Sufficient default width** – truncation should be exception
- **Resize capability** – Allow users to drag column borders to expand width
- **Priority truncation** – truncate least important columns first

### Warning Signs
- All columns truncated
- Primary identifier truncated (users can't distinguish rows)
- No tooltips on truncated text
- **Table crushed by adjacent panel** – see Detail Panels section

### Table Width Considerations
1. **Evaluate column necessity** – Does the user need all visible columns? Consider column visibility toggles, responsive column hiding, or moving secondary data to the detail view
2. **Protect table space** – If a side panel opens, it should not compress the table to unusable widths
3. **Consider text wrapping** – For some content (like descriptions), wrapping to 2 lines may be better than truncation

---

## Icon-Only Buttons

### Requirements
- **Always include tooltips** – mandatory
- **Use recognizable icons** – trash = delete, pencil = edit
- **Min 24×24px** click target (44×44px for touch)
- **Consistent placement** – Same icon should mean the same thing across the product

### When Reviewing (from screenshots)
- Assume tooltips may be missing – flag as warning to verify
- For critical/destructive actions, prefer icon + label

### Icon Button Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Icon without tooltip | Users must guess | Always add descriptive tooltip |
| Ambiguous icon | Multiple interpretations | Use label, or choose clearer icon |
| Too many icon buttons | Toolbar overwhelming | Group actions, use dropdown menus |
| Inconsistent icons | Same icon means different things | Audit and standardize meanings |

---

## Content Positioning

### Where to Put Important Content

| Position | Best For | Why |
|----------|----------|-----|
| **Top-left** | Logo, navigation, page title | First scanned area (F-pattern) |
| **Top-right** | User menu, notifications, global actions | Expected location for account/settings |
| **Above the fold** | Key messages, primary CTA | Visible without scrolling |
| **Left sidebar** | Navigation, filters | Persistent access while viewing content |
| **Right sidebar** | Contextual info, help, related items | Secondary information area |
| **Bottom of forms** | Submit/Cancel buttons | Natural flow after completing fields |

### Mobile Considerations
- **Thumb zone** – Place primary actions within easy thumb reach (bottom of screen)
- **Bottom navigation** – Most important nav items should be easily tappable
- **Avoid top corners** – Difficult to reach with one hand on large phones

---

## Error Handling

### System Errors vs. User Code Output

| Type | Treatment |
|------|-----------|
| **System errors** (API failures, permissions) | Human-readable with actionable guidance |
| **User code output** (stderr, stack traces) | Show raw output in monospace; users need it for debugging |

#### User Code Output (stderr, logs, stack traces)
- **Show the raw output** – Data scientists need the full stack trace for debugging
- **Use monospace font** – Preserves formatting and alignment
- **Provide context** – Label clearly (e.g., "stderr", "stdout") so users know what they're looking at

### Error Message Principles
1. Be human-readable – "Your session expired" not "Error 401"
2. Explain what happened and what to do next
3. Be specific – "Password must be 8+ characters" not "Invalid password"
4. Don't blame the user – "We couldn't find that page" not "You entered a wrong URL"

### Error Placement

| Type | Placement | When to Use |
|------|-----------|-------------|
| **Inline validation** | Next to field | Form field errors (preferred) |
| **Inline banner** | Top of form/section | Multiple related errors, form submission failures |
| **Toast notification** | Corner of screen | Async errors, background failures |
| **Modal dialog** | Center of screen | Critical errors requiring immediate attention |
| **Full page** | Replace content | 404, 500, permission denied, maintenance |

### Inline Errors (Preferred)
- Show errors immediately adjacent to the problematic field
- Use red color and error icon for visibility
- Keep error text concise but helpful
- **Don't clear the user's input** – let them correct it

### Toast Notifications
- Use for async operations (API failures, background sync)
- Auto-dismiss after 5-8 seconds for non-critical messages
- Provide a dismiss button for immediate closure
- Include action buttons when relevant ("Retry", "View details")
- Stack multiple toasts – don't overlap or replace

### Error Message Examples

| Bad | Good |
|-----|------|
| "Error" | "Unable to save changes" |
| "Invalid input" | "Email address must include @" |
| "Request failed" | "Couldn't connect to server. Check your internet connection." |
| "Unauthorized" | "You don't have permission to view this. Contact your admin for access." |

---

## Data Visualization & Charts

### Chart Type Selection
- **Line charts**: Trends over time
- **Bar charts**: Comparing categories
- **Pie charts**: Parts of a whole (use sparingly, max 5-6 slices)
- **Tables**: Precise values, many dimensions

### General Rules
- **Label clearly** – Title, axis labels, units, and legends should be unambiguous
- **Don't distort data** – Start y-axis at zero for bar charts; be transparent about truncated axes
- **Reduce chartjunk** – Remove unnecessary gridlines, 3D effects, decorations

### Axis Scaling
- **Y-axis starts at zero** for bar charts to avoid exaggerating differences
- **Line charts may truncate** y-axis if zero isn't meaningful, but clearly indicate this
- **Avoid dual y-axes** unless absolutely necessary – they're often misleading
- **Round to appropriate precision** – Don't show "45.2367%" when "45%" suffices

### Time Series Rules
- **Scale the time axis to the selected range** – If user selects "Last 7 days", show 7 days, not the full data range
- **Use consistent time intervals** – Don't stretch/compress irregular intervals
- **Handle missing data transparently** – Show gaps or clearly indicate interpolation
- **Use relative dates for recent data** – "2 hours ago" is more useful than a full timestamp

### Empty States in Charts
- Don't show empty axes – an empty chart with just axes is confusing
- Explain why there's no data: "No runs in the selected time period"
- Suggest actions: "Run a job to see metrics here" or "Adjust your date filter"

### Interactive Charts
- Provide hover/click details with tooltips showing exact values
- Allow zooming and panning for dense time series
- Show loading states – don't display empty charts while data loads

### Chart Color Guidelines
- Use **colorblind-safe palettes** – Avoid red/green only distinctions
- **Limit colors** – Max 5-7 distinct colors per chart
- Use **sequential colors** for ordered data (light to dark)
- Use **categorical colors** for unrelated categories
- **Highlight important data** – Use a distinct color for key metrics

---

## Form Design Best Practices

### Layout
- **One column layouts** are easier to scan
- **Group related fields** with section labels
- **Logical order** – Follow natural sequence (name, email, phone, address)
- **Show only necessary fields** – every field reduces completion

### Labels & Instructions
- Labels above fields (not placeholder-as-label)
- Keep labels short – "Email" not "Please enter your email address"
- Helper text below field for complex requirements
- Mark required fields with asterisk (*) or "(required)"

### Validation
- Validate on blur, not every keystroke
- Show success states – green checkmark for valid fields
- Preserve user input on errors
- Scroll to first error on submission

### Radio selectors & checkboxes as click targets
- When there's a label + radio or label + checkbox pair, clicking anywhere on the pair should toggle the form element (not just the checkbox or radio itself)

### Smart Defaults
- **Pre-fill when possible** – Use known information (user's name, timezone)
- **Select sensible defaults** – Most common option should be pre-selected
- **Remember recent choices** – Especially for repeat workflows

### Checkbox & Toggle Semantics

**Checked = ON / Enabled / Active** (not the reverse)

| Bad | Good |
|-----|------|
| ☑️ "Disable notifications" | ☑️ "Enable notifications" |
| ☑️ "Hide advanced options" | ☑️ "Show advanced options" |
| ☑️ "Don't send me emails" | ☑️ "Send me email updates" |
| ☑️ "Exclude from search" | ☑️ "Include in search" |

#### Why This Matters
- Users expect checked = active/on (mental model from light switches)
- Double negatives are confusing: "Uncheck to not disable" = ???
- Scanning checkboxes should quickly show what's enabled

#### Checkbox vs. Toggle

| Control | Best For |
|---------|----------|
| **Checkbox** | Multiple selections, opt-ins, settings that apply on form submit |
| **Toggle switch** | Binary on/off that takes effect immediately |

#### Toggle Labels
- Put the label **before** the toggle, describing what it controls
- The toggle shows the state (on/off) — don't duplicate in the label
- **Good:** "Email notifications" [toggle]
- **Bad:** "Enable email notifications" [toggle] (redundant)

---

## Long Form Best Practices

### When to Use Collapsible Sections
- Forms with **more than 5-6 distinct sections** should collapse optional/advanced content
- Primary/required fields visible; optional sections collapsed by default
- Show summary indicators when collapsed (e.g., "2 variables defined")

### Section Indicators
- Mark optional sections with "Optional" label
- Show item counts for collapsed sections to indicate state

### When to Consider Wizards/Steppers
- Linear workflows with dependencies between steps
- When form has natural phases (Base → Configuration → Review)
- When users need guidance on completion order

---

## Code & Script Input Fields

Domino has many code editors. Apply these patterns:

### Placeholder Guidance
- Always include example code or syntax hints in empty editors
- Show language-specific examples (bash for scripts, Dockerfile syntax)
- Include comments explaining constraints

### Examples

**Dockerfile editor:**
```
# Add custom Dockerfile instructions
# Example: RUN pip install torch torchvision
# Note: Do not use FROM instruction
```

**Script editor:**
```bash
#!/bin/bash
# Script runs after workspace starts
# Example: export MY_VAR=value
```

### Visual Treatment
- Use monospace fonts
- Consider syntax highlighting
- Show line numbers for multi-line editors

---

## Empty States & Actionable Guidance

Empty states are opportunities to guide users, not dead ends. Every empty state should answer three questions:

1. **What is this?** – What content would appear here
2. **Why is it empty?** – Context
3. **What can I do?** – Clear action

### Examples

| Context | Bad | Good |
|---------|-----|------|
| No tags | "No tags" | "No tags yet — Tags help organize jobs. [+ Add tag]" |
| Empty table | (blank) | "No jobs found. [Run a job] or adjust filters." |
| Empty code editor | (blank with line number) | Placeholder with example code and syntax hints |
| Empty search | "No results" | "No jobs match your search. Try different keywords or [clear filters]." |

### Why Actionable Empty States Matter
1. **Discoverability** – Users learn features exist and when to use them
2. **Reduced friction** – One-click path to the likely action
3. **Education** – Brief explanation teaches the feature's purpose
4. **Confidence** – Users understand the system state (empty vs. loading vs. error)

### Empty vs. Zero vs. Error State

| State | Treatment |
|-------|-----------|
| **Empty** (nothing exists yet) | Educational, show path to populate |
| **Zero** (filter returns nothing) | Help adjust filters |
| **Error** | Explain and provide recovery action |

### Guidelines for Empty State Copy
- **Be concise** – One sentence for "what/why", one clear CTA
- **Use helpful tone** – "No tags yet" (neutral) not "You have no tags" (blame)
- **Make CTAs specific** – "Add tag" not "Get started"

### Visual Treatment
- Use subtle, muted styling (not alarming like errors)
- Center content vertically and horizontally in the empty area
- Consider an illustration for first-time/onboarding empty states (not for every empty list)
- Keep CTAs visually prominent (button, not just link)

---

## Interaction Feedback

### Users Need Feedback For
- **Hover states** – Visual change when mouse is over interactive elements
- **Click/tap acknowledgment** – Button press animation, color change
- **Loading states** – Spinner, skeleton, progress bar for async operations
- **Success confirmation** – Visual confirmation that action completed
- **State changes** – Clear indication when something toggles on/off

### Loading States
- **Disable interactive elements** while loading to prevent double-submission
- **Show progress** for file uploads and long operations
- **Provide cancel option** for long-running operations

---

# UX Review Guide

When reviewing UI screenshots, systematically check these areas.

## Review Checklist

### Layout & Space
- [ ] Side panels overlay (not crush) content?
- [ ] Table width adequate — not crushed by adjacent panels?
- [ ] In content panels with mixed elements, is differential spacing used to group related items?
- [ ] Visual hierarchy clear?

### Tables
- [ ] Tooltips on truncated text? (flag as warning if can't verify)
- [ ] Column necessity — does the table show only needed columns?
- [ ] Users can distinguish rows?
- [ ] Data alignment correct — numbers right-aligned, text left-aligned?

### Interactive Elements
- [ ] Icon buttons have tooltips? (flag as warning)
- [ ] CTAs action-oriented and specific?
- [ ] Is there exactly **one Primary (solid filled) button** per view/modal? Are other buttons styled as Secondary/Tertiary?
- [ ] Disabled states explained?
- [ ] Touch targets large enough (min 24×24px desktop)?
- [ ] Actions positioned near related content?

### Empty & Error States
- [ ] Empty states actionable with what/why/action?
- [ ] System errors human-readable?

### Forms
- [ ] Form length reasonable? Optional sections collapsible?
- [ ] Code inputs have placeholder guidance?
- [ ] Optional sections marked?

### Content & Information
- [ ] Progressive disclosure — advanced content hidden until needed?
- [ ] Proximity grouping — in content panels, are related items visually clustered?

## Severity Classification

| Severity | Definition | Examples |
|----------|------------|----------|
| **High** | Blocks goals or causes significant confusion | Missing error guidance, unreadable tables, no access to truncated data |
| **Medium** | Slows users or reduces confidence | Missing tooltips, poor grouping, non-actionable empty states |
| **Low** | Minor polish | Suboptimal spacing, minor copy improvements |

## What NOT to Flag

- User code output shown raw (expected for debugging)
- Uniform table row spacing (correct pattern for tables)
- Dense displays for technical users (job logs, etc.)

## Screenshot Limitations

Cannot verify from static screenshots:
- Tooltip presence (flag as "verify tooltips exist")
- Hover/focus states
- Loading states
- Responsive behavior
- Keyboard navigation

---
