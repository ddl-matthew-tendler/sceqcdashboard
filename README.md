# Domino Apps & Prototypes

This repo contains Cursor rules, boilerplate modules, and reference code for two distinct workflows: **building Domino apps** and **making design prototypes**. Each has its own rule file because the goals, audience, and output are fundamentally different.

| | Domino App | Design Prototype |
|---|---|---|
| **Who** | Any developer building an app that runs on Domino | Domino design team handing off to engineering |
| **Goal** | Working application deployed on the platform | Interactive spec showing engineering exactly which `@domino/base-components` to use |
| **Stack** | FastAPI + Ant Design CDN (direct) | FastAPI + Ant Design CDN behind an alias layer that exposes real Domino component names |
| **Component names** | Plain antd (`Button`, `Table`, `Modal`) | Real Domino names (`DominoTable`, `Callout`, `Wizard`) with `data-domino-component` attributes |
| **Extras** | Domino theme, API auth, env vars | Dev mode overlay, comment system, stand-in library |
| **Rule file** | `how-to-build-domino-apps.mdc` | `domino-real-components-reference.mdc` |

The rules are separate so the agent doesn't conflate the two — app prompts should never trigger the alias layer / dev-tools overhead, and prototype prompts should never skip the component discovery workflow.

## How to Prompt

### For apps — say "domino app"

> Create a **domino app** that uses our APIs to summarize jobs run activity with a flexible time window selector component that defaults to last 7 days. Use a summary chart and a table below.

> Build a **domino app** with a dashboard showing compute environment usage. Include a dropdown to filter by project, a bar chart of resource consumption, and an expandable details section for each environment.

> Create a **domino app** that displays model deployment status across projects. Use a card grid layout with health indicators, and add a search/filter bar at the top.

### For prototypes — say "domino prototype"

> Create a **domino prototype** for a new Project Settings page with tabs for General, Access, and Hardware. Use the real component names from base-components.

> Build a **domino prototype** of a model registration wizard with three steps: select source, configure metadata, and review. Include dev tools for engineering review.

> Make a **domino prototype** showing a data source browser with a tree view, search bar, and detail panel. Tag every component with its real import path.

The keyword difference ("app" vs "prototype") is what triggers the correct rule. Both workflows are otherwise automatic — the agent handles theme, structure, and component wiring.

## Quick Start

### 1. Download Frontend Code

Download the Domino frontend code manually from:

**https://github.com/cerebrotech/frontend-web-ui-service**

1. Go to the repository URL above
2. Click the green **Code** button → **Download ZIP**
3. Extract the ZIP contents into the `example_domino_frontend_code/` folder in this project

Alternatively, using git:

```bash
git clone --depth 1 https://github.com/cerebrotech/frontend-web-ui-service.git example_domino_frontend_code
rm -rf example_domino_frontend_code/.git
```

> **Note:** The contents of `example_domino_frontend_code/` are gitignored and won't be tracked.

### 2. Copy to Your Cursor Project

#### Option A: Using Terminal

Copy all necessary files to your project:

```bash
cp -r example_domino_frontend_code/* /path/to/your/cursor/project/ && \
cp -r .cursor /path/to/your/cursor/project/ && \
cp .gitignore domino-logo.svg swagger.json governance_swagger.json /path/to/your/cursor/project/
```

#### Option B: Using macOS Finder

1. Open this folder in Finder
2. Press **`Cmd + Shift + .`** to show hidden files (the `.cursor` and `.gitignore` will appear)
3. Select and copy all the files you need to your project folder
4. Press **`Cmd + Shift + .`** again to hide hidden files when done

> **Tip:** Hidden files appear slightly dimmed in Finder when visible.


## Cursor Rules Setup

The `.cursor/rules/` folder contains three rule files. The first two are agent-requestable — the agent pulls them in automatically when your prompt matches their description. The third is manual.

| Rule | Triggered by | Purpose |
|------|-------------|---------|
| `how-to-build-domino-apps.mdc` | Prompts about building a "domino app" | Stack, theme, API auth, env vars, `app.sh` |
| `domino-real-components-reference.mdc` | Prompts about building a "domino prototype" | Alias layer, stand-ins, dev tools, component discovery workflow |
| `usability_design_principles.mdc` | Manual `@` mention only | UX principles, layout patterns, component selection guidance |

### Applying the Usability Design Principles

The `usability_design_principles.mdc` rule is **not auto-applied** and must be manually included when you want Cursor to follow UX/design guidelines. This is useful for both apps and prototypes.

**To apply it in a conversation:**

1. In Cursor's chat or composer, type `@` to open the mention picker
2. Select **Files & folders**
3. Navigate to `.cursor/rules/usability_design_principles.mdc`
4. The rule will be included in that conversation's context

**Example:**

```
@.cursor/rules/usability_design_principles.mdc

Build a domino app with a settings page that has a form for user preferences
```

This tells Cursor to follow Domino's design system (button hierarchy, typography, spacing, error handling, etc.) on top of whichever workflow (app or prototype) you're using.

## API Reference

- **[swagger.json](swagger.json)** - Main API documentation
- **[governance_swagger.json](governance_swagger.json)** - Governance API documentation
