# Demo Script — TFL Agent in the Loop, driven from the Study Lead QC Hub

**Audience:** Data Science, Clinical Programming, or Governance stakeholders
**Runtime:** ~9 minutes live (1 min framing + 3 min agent runs + 5 min walkthrough)
**What it shows:** Two AI agents autonomously writing and QC-checking a clinical table — operated, governed, and advanced entirely from one app, with a human making the final call and a full audit trail underneath.

**The one new idea to land:** Governance bundles are the system of record, but a study lead doesn't live in the Govern UI. The QC Hub is a purpose-built lens on the *same* bundles — it's where you see the whole portfolio, operate the agents, and advance work, without ever leaving the app or hand-editing governance.

---

## Opening Hook (~45 seconds)

> "Clinical table programming has the same problem it always has — two programmers, two outputs, a deadline, and a lot of manual reconciliation. What we built flips that model. An AI agent writes the program. A second, independent AI agent QCs it. A human study lead reviews both and signs off. Every step lands in a governance bundle with a full audit trail.
>
> But here's the part I want you to watch for: you're not going to see me touch the Govern admin UI, write code, or hand-edit a bundle. Everything — operating the agents, watching them run, advancing the work — happens from one app the study lead actually lives in. Let me show you."

---

## Scene 1 — The QC Hub: the portfolio at a glance (~1.5 minutes)

Open the **Study Lead QC Hub** app (landing dashboard).

> "This is the QC Hub. It's not the Domino Govern UI — it's a purpose-built app sitting on top of it. Every bundle you see here is a live governance bundle; the app just reads and writes the same governance API a compliance officer would. The difference is what a study lead can do with it."

Point to the portfolio: the bundle list, the stage-progress column, the stat cards / donut.

> "Across the whole program: every deliverable, what stage it's in, who it's assigned to, what's blocked. The progress column shows each bundle's policy stages at a glance — green for done, purple for the active stage. This is the view that used to live in a spreadsheet tracker."

*(Optional, sets up Scene 6)* Hover the **Advance Stage** action in the bulk bar — don't click yet.

> "And because it's portfolio-level, I can act on many bundles at once. Hold that thought."

---

## Scene 2 — Opening one bundle, in-app (~1.5 minutes)

Click the row **Demo — T 14.1.1**. The detail drawer opens on the **Stage Timeline**, then switch to the **Evidence** tab.

> "A bundle is one instance of the policy against a specific table — T 14.1.1, demographics. Think of it as the regulatory dossier for this one deliverable. Before, to see what was actually answered in each stage, you'd leave for the Govern UI. Here it's all inline."

Walk the stepper, then expand **Stage 1** (complete, read-only).

> "Four stages: two manual bookends, two agent steps in the middle. Stage 1 is manual — a human confirms the ADaM is frozen and the shell matches the current SAP. Complete stages are read-only; the active stage is editable right here in the drawer; pending stages are locked until they're reached. So the app enforces the same order the policy does."

Point to the **View in Domino** button in the drawer header.

> "And this is the honesty check — one click takes you to the exact same bundle in Domino's Govern UI. The app isn't a parallel copy of the truth. It's a faster lens on it."

---

## Scene 3 — Stage 2: operating the first-line agent (~2 minutes)

Expand **Stage 2 — Generate TFL**. Point to the **✨ Run Agent** button on the scripted-check row, then hover it on a *non-agent* stage assignee (or describe it) to surface the disabled tooltip.

> "Here's the capability that ties the whole story together: I operate the agent from inside the bundle. But notice — I can't just run it. This button is gated. It only lights up when the stage is assigned to an agent identity. If a human is the assignee, it's disabled, and the tooltip says so: *'assign an agent user to this stage to run automation.'*"

> "That's deliberate. The job runs under whoever launches it. So the rule is: **only an agent runs the scripts.** A person can't quietly kick off automation under their own name and muddy the audit trail. The policy decides which stages are the agent's to act on; the app enforces it."

Click **✨ Run Agent**.

> "The agent gets the SAP excerpt, the table shell, and a machine-readable TFLSpec we extracted from those documents. It writes the SAS-style Python program, commits it to a feature branch in the project repo, executes it, and attaches the RTF output back to this bundle — without a human touching a file."

While the job runs (~60–90s), narrate the live UI. The **Agent is running** banner shows a spinner, live job status, and a ticking elapsed timer; the Result panel tails stdout/stderr.

> "This isn't a black box. It's a real Domino job — same environment, same hardware tier, reproducible every time. The status is live, the logs are tailing, and there's a 'Job ↗' link straight to the Domino jobs page if an auditor wants the raw run. Watch the evidence fields below — they're empty now."

Job completes. The agent-written fields populate, each badged **✨ AGENT** with a subtle purple gradient. Switch to the **Attachments** tab to show the RTF.

> "There it is. Three things just happened, and the app shows you all three. The evidence fields filled in — and notice the **AGENT** pill on each one. That's not decoration: it tells the study lead, at a glance, which values a human entered and which an agent did. The git commit hash is captured — the immutable link between this bundle and the code that produced it. And the executed RTF is attached, deep-linked to the exact commit in the repo. A complete, executed clinical table, auditably committed, attached to a regulated bundle — in under two minutes."

---

## Scene 4 — Stage 3: the independent QC agent (~2 minutes)

Expand **Stage 3 — QC Review**. Note the assignee is a *different* agent identity, then click **✨ Run Agent**.

> "Now the second agent — assigned to its own agent identity, gated the same way. It runs completely independently. It never sees the first agent's reasoning or its code. It reads the ADaM source data directly, computes its own cell-level statistics, and compares them against the output. It's not checking the code — it's checking the numbers."

While it runs, briefly show the QC reviewer prompt context.

> "The QC agent returns a structured JSON findings document — what matched, what didn't, suggested next steps. Not a paragraph you have to parse. Machine-readable evidence that flows straight into the bundle fields, AGENT-badged, just like Stage 2."

Job completes. Show the discrepancies and suggested-next-steps fields populated.

> "In this run the stats match. The one finding flagged is a capitalisation inconsistency in Race values — exactly what a careful human QC reviewer would catch. Two agents, two outputs, reconciled automatically, and I never left the bundle to make it happen."

---

## Scene 5 — The audit trail underneath (~1 minute)

Open **Experiments → tfl-agent-in-the-loop** (or the traces link from the app).

> "Everything you just operated from the app generated this underneath. Every LLM call from both agents is traced — token usage, latency, cost, the full span tree. This is what an auditor needs when an AI acts on a regulated deliverable. Not 'an AI was involved' — exactly which model, which inputs, which outputs, at what cost, on which run. The app is the convenient surface; the governance bundle and the trace are the durable record."

---

## Scene 6 — Stage 4: the human, and acting at portfolio scale (~1 minute)

Back in the drawer, expand **Stage 4**.

> "Stage 4 is the human. The study lead reviews the program, the output, the QC findings — all right here — and makes an explicit Accept, Reject, or Partial decision. The agents do the repetitive work; the human exercises judgment on their recommendations, and that decision is captured as evidence. The app makes the human the *fast* part of the loop, not the bottleneck."

Close the drawer. Select several bundles and open **Advance Stage** in the bulk bar.

> "And one more thing that only makes sense once the work is this clean: I can advance many bundles at once. The app runs a pre-flight on every selected bundle — it checks that each one's required fields are actually filled before it advances any of them, and tells me honestly which ones aren't ready. No round-trip-and-fail. A study lead manages the whole program from one screen, not one bundle at a time."

---

## Close (~30 seconds)

> "What you just saw: a complete clinical table produced, QC'd, and prepared for sign-off in under five minutes — with a governance bundle, a git commit trail, and an LLM audit log, none of which needed a human to write code or run a comparison by hand. The agents do the work. The policy enforces the process — including the rule that only an agent runs the scripts. And the study lead operates and advances the entire portfolio from one app, while Govern stays the system of record underneath."

---

## Anticipated questions

### Architecture & "how does it actually work"

- **"Is this running as a Domino Agent, or is it just a Python script running as a job?"** → It's plain Python scripts running as Domino jobs. No Domino Agent SDK, no built-in tool-use loop, no planning framework. The "agentic" behavior is the script itself orchestrating several LLM calls in sequence. Calling it an "agent" describes the *role* in the workflow (write the program / QC the output), not a specific agent runtime.

- **"So it's just calling out to Claude?"** → Yes. The script resolves an LLM provider in priority order — Domino AI Gateway first (the OpenAI-compatible proxy, so calls are centrally keyed, logged, and monitored), then a direct OpenAI key, then a direct Anthropic key (the Anthropic SDK against Claude, with prompt caching on). In a Domino deployment it goes through the Gateway, which is what gives you the cost and usage controls.

- **"What makes the first-line step 'agentic' if there's no agent framework?"** → The script does multi-step orchestration on its own: generate the program → execute it → if it errors, feed the traceback back to the model and ask for a repair (up to 3 attempts) → then a separate call to draft a deviation rationale. It's a deterministic loop the script controls, not a model deciding its own next action.

- **"And the QC step?"** → The QC script computes independent statistics directly from the ADaM data in code (not via the LLM), then sends those stats plus the first-line output to the model and asks for structured JSON findings. With `--auto-resolve` it can loop back and ask the first-line agent to regenerate using the QC findings as feedback. The numeric comparison is real code; the LLM characterizes and explains the differences.

- **"What's the compute environment named 'Agents w/ DSE Py3.1 R4.5' — is that a special agent runtime?"** → No. That's just what someone named the environment. The scripts only need the `anthropic` / `openai` packages installed; the name is cosmetic.

- **"What happens if there's no API key in the demo environment?"** → Both scripts fall back to prebaked responses from `sample/prebaked/`. The governance ceremony still runs end to end — bundle fields populate, attachments land — so the workflow is demoable without a live credential. Worth knowing for a booth or offline demo; in a real run the Gateway path is live.

### Governance, control, and trust

- **"Is the app the source of truth, or is governance?"** → Governance is. The app reads and writes the same bundles through the governance API — the "View in Domino" button proves it. The app is a faster, study-lead-shaped lens; nothing lives only in the app.

- **"How do you stop a person from running the agent under their own name?"** → The Run Agent button is hard-disabled unless the stage is assigned to an identity with "agent" in its name. The job runs under whoever launches it, so this keeps the audit trail clean — automation is always attributed to the agent, never a person who happened to click.

- **"Where exactly do the agent's outputs go?"** → Three places, all visible in the app: evidence fields on the bundle (AGENT-badged), a commit on a feature branch in the project repo (hash captured as evidence), and the executed RTF attached to the bundle and deep-linked to that commit.

- **"What if the LLM hallucinates a statistic?"** → The QC agent computes independent stats from ADaM *in code* and compares cell by cell — it's built to catch exactly that. The model explains discrepancies; it doesn't produce the numbers being checked. And the study lead is the final gate.

- **"Can the agent advance its own stage or sign off?"** → No. Agents run scripted checks and write evidence. Stage transition is a separate action, and the final Accept/Reject/Partial decision is Stage 4, which is human-assigned. The agent can't approve its own work.

- **"How is this auditable for a regulated submission?"** → Three layers: the governance bundle (who submitted what, when), the git commit pinning code to output, and the GenAI trace (model, inputs, outputs, tokens, cost per run). An auditor can reconstruct exactly what the AI did on a given deliverable.

- **"Which model is it, and can we pin a version?"** → It targets Claude through the configured provider. Because it goes through the AI Gateway, the model and version are a central configuration concern, not something baked into each script — so you can pin, swap, or route per policy without touching the workflow.

### Fit, scope, and rollout

- **"Can we use this for SAS, not Python?"** → Agents generate Python against the ADaM layer today. SAS is a prompt change — the governance, gating, tracing, and app surface are language-agnostic.

- **"How does this integrate with our existing QC process?"** → The policy replaces the manual tracker; existing SOPs map to stages, and the scripted checks replace the "run program, email QC" handoff. The QC Hub is the day-to-day surface on top of it.

- **"Does every reviewer need to learn the Domino Govern UI?"** → No — that's the point of the QC Hub. A study lead operates entirely in the app. Govern stays available for compliance/admin, and "View in Domino" bridges the two when needed.

- **"What's the human's role if the agents do the work?"** → Judgment, not typing. The human confirms preconditions (Stage 1), reviews both agents' output, and makes the explicit accept/reject call (Stage 4). The app is designed to make the human the fast part of the loop, not the bottleneck — including advancing many bundles at once once they're ready.

- **"Can it scale across a whole program, not one table?"** → Yes — the dashboard is portfolio-level, and bulk **Advance Stage** moves many bundles at once with a per-bundle pre-flight that checks required fields before advancing any of them.

- **"What's next?"** → "Open in Workspace" — from any attachment, one click into a running Domino workspace pinned to the same project and commit, so a programmer can pick up exactly where the agent left off. That's in design now (see `OPEN_IN_WORKSPACE_DESIGN.md`).

---

## Notes for the presenter

- **The spine changed from the original draft.** The earlier script toured Domino's Govern UI scene by scene. This one is driven end-to-end from the **QC Hub app**, because that's the actual story — a study-lead surface over governance. Scene 2's "View in Domino" beat keeps you honest that it's the same bundle, not a parallel system.
- **"Only an agent can run the scripts" is its own headline beat** (Scene 3), grounded in the real gating logic — the Run Agent button is disabled unless the stage assignee's name contains "agent".
- **"Where the outputs go" is made explicit** (Scene 3 close): evidence fields + AGENT pill, git commit hash, attached RTF deep-linked to the commit.
- **Bulk advance** is folded into Scene 6 as the portfolio-scale payoff.
- **"Open in Workspace" stays in "what's next,"** not the live walkthrough — per `OPEN_IN_WORKSPACE_DESIGN.md` it's still pre-implementation, so demoing it live would over-promise.
- **Be ready for the "is it a real agent?" question.** Answer it plainly: plain Python scripts running as Domino jobs, orchestrating Claude calls through the AI Gateway — no agent framework. That honesty lands better than implying a runtime that isn't there, and the governance story (gating, git, traces) is what actually impresses.
