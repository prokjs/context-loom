# Context Loom

**Created by [prokjs](https://github.com/prokjs).**

Context Loom is a local-first AI context workspace that turns your goals, work scope, and reusable memories into a focused prompt. Use it to prepare context for an existing AI tool, or explicitly approve a separately billed OpenAI API request.

[Download for Windows](https://github.com/prokjs/context-loom/releases/latest) · [Source repository](https://github.com/prokjs/context-loom)

## Aim of the project

Working with AI often means repeating the same background, past decisions, boundaries, and answer preferences. Sending an entire growing conversation can waste context, hide the current task, and encourage unnecessarily long answers.

Context Loom aims to help users:

- **Repeat less:** save useful project facts and decisions instead of explaining them again each time.
- **Stay in scope:** define what the model should work on, what it should leave alone, and which constraints matter.
- **Send less irrelevant context:** select relevant memories within a visible budget rather than append an entire history.
- **Get focused answers:** default to concise, answer-first instructions without asking the model to sacrifice correctness.
- **Understand the cost:** keep local compilation free and show estimated additional API charges before any direct request.
- **Keep control of their data:** inspect the exact prompt and choose what to save or send.

This is a context-preparation tool, not a new AI model. It does not retrain a model, read its hidden reasoning, or guarantee token savings. Shorter input can reduce input-token use, but total cost and answer quality also depend on the model, task, reasoning, and output.

## How it works

1. **Set the starting context.** A short questionnaire captures the project's goal, in-scope and out-of-scope work, constraints, answer detail, and clarification preference. These settings become the project's reusable brief; they do not modify a model's weights.
2. **Curate project memory.** Save self-contained facts, decisions, or preferences. Memories belong to one project. You can tag, pin, edit, disable, or delete them; the app does not automatically turn every conversation into permanent memory.
3. **Compile locally.** Enter the current task. The compiler prioritizes enabled pins, ranks other memories using task/scope keywords and tags, removes duplicate memory text, and includes whole memories that fit the approximate memory allowance. No paid model call is used to build the prompt.
4. **Inspect before sending.** The preview combines concise instructions, the project brief, the unchanged current task, and selected memories. It lists omissions and compares approximate input size with the same brief containing all enabled memories. Saved memory is marked as reference data, not authority to override the current task.
5. **Choose an execution path.** Copy/download the prompt for another AI tool, or review the API estimate and approve a single direct request. Direct execution can apply supported reasoning-effort and output-token controls; pasted instructions cannot force a receiving tool to use those controls.
6. **Carry forward only useful results.** After a direct response, review and edit any useful decision or fact before saving it as a new memory. This keeps the next task's context deliberate instead of growing a transcript indefinitely.

There is no background model call for onboarding or memory selection. The selection method is deterministic keyword matching, not an AI summary or semantic search. Inspect the selected memories when a task depends on subtle context.

## Creator, attribution, and usage rights

**Context Loom is made by prokjs. Copyright (c) 2026 prokjs. All rights reserved, except for the permissions explicitly granted in [LICENSE.txt](LICENSE.txt) and applicable third-party licenses.**

The official app may be used for personal work and internal organizational work, including commercial work. Its source is available for inspection, but **this is not an open-source license**. Without prior written permission from prokjs, do not redistribute, sell, sublicense, rebrand, publish modified copies, remove attribution, or present the project as your own. Giving credit alone does not grant those permissions.

These restrictions apply to Context Loom's original software and documentation, not to your own project data, memories, prompts you compose, or AI responses. Bundled Node.js and other third-party components retain their own licenses. GitHub's platform rights and rights that applicable law makes non-waivable are not overridden.

Copyright and license terms establish conditions for use and reuse; they do not technically prevent copying, guarantee enforcement, or grant ownership of general ideas. Contact [prokjs](https://github.com/prokjs) for reuse permission.

## Languages

The interface and normal launcher messages support **English, 한국어 (Korean), 简体中文 (Simplified Chinese), 日本語 (Japanese), Español (Spanish), Français (French), Deutsch (German), Русский (Russian), and Português (Portuguese)**.

Choose **Interface language** in the header or in the first-run setup dialog. The choice is saved on your computer and restored after restarting the executable, even though its localhost port changes. Switching languages preserves unsaved project, task, and memory drafts and clears paid-request approval.

Each project also has an independent **Answer language** setting: automatic (follow the task) or any of the nine languages. This preference is included in the compiled instructions; a model's compliance is not guaranteed. Changing the interface language does not translate or rewrite your saved tasks, scope, or memories.

Controls, onboarding, cost disclosures, consent, confirmations, and validation messages are translated. Original technical diagnostics, API identifiers, legal notices, and the generated instruction scaffold may remain in English. Currency remains explicitly labeled USD. Memory matching uses word segmentation and two-character CJK script terms; it is lexical matching, not semantic search or automatic translation.

## Download and run — Windows

Download `Context-Loom-1.2.0-windows-x64.exe` from the repository's **[Releases](https://github.com/prokjs/context-loom/releases)** page and double-click it. No installer, Node.js installation, npm, administrator access, or terminal commands are required. Windows 10/11 x64 is the build target; ARM64-native and other operating-system binaries are not provided.

The executable starts the local app and opens it in your default browser. Keep its launcher window open while working. Close the launcher window or press Ctrl+C there to quit; closing the browser tab alone does not stop it. Double-clicking the executable again reopens the same running instance instead of starting a second writer. The app chooses a free loopback port, so use the opened address rather than a bookmarked fixed port.

**The executable is unsigned.** Windows or a browser may warn about an unknown publisher or download reputation. No code-signing identity or SmartScreen reputation is claimed. Verify the source and SHA-256 checksum before deciding whether to run it; do not disable Windows security protections. Third-party runtime license notices are included in Releases and embedded in the executable (`--licenses`).

Private executable data stays at `%LOCALAPPDATA%\ContextLoom\state.json`, not beside the download. Replacing the executable preserves it. Existing source-run data is not automatically imported: export a project backup from the older app and import it into the executable app.

### Run from source

Requires Node.js 24 or later. No dependency installation is needed merely to run the source app. From this directory, run `npm start`, then open http://127.0.0.1:4317. On Windows, `Start-Context-Loom.cmd` does the same. Keep the terminal open; Ctrl+C stops it. Source mode keeps its own `data/state.json` in this directory.

Both modes listen only on loopback. Do not expose or reverse-proxy the app to a network: it is a single-user local app, not an authenticated hosted service. Other processes on your computer can access its local data. Use one editing browser tab to avoid last-save-wins overwrites.

## Workflow

1. Create a project: goal, in/out scope, constraints, answer detail, and ambiguity preference. New projects default to concise answers. Edit the profile later as work changes.
2. Add reusable facts or decisions with useful tags. Enable, disable, edit, delete, or pin individual memories. Projects keep separate memories.
3. Describe the current task. Set the approximate memory allowance, output token cap, and optional direct-API reasoning effort.
4. Compile locally. Review the exact prompt, selected/omitted memories, and approximate token comparison. Copy or download the prompt for another AI tool; Context Loom charges nothing for compilation or export. The destination tool can have its own charges.
5. Optionally enter an OpenAI API key, inspect the estimated additional charge, tick the per-request consent, and run once. A context edit invalidates the preview and consent. There are no automatic retries.
6. Review useful answer text before saving it as a memory. Whole conversations are not automatically accumulated.

## Memory and token limits

Selection is deterministic: enabled pins first, then keyword relevance against task and scope, within the approximate allowance. Word segmentation and two-character CJK script terms support text without spaces and common Korean suffixes. Common English stop words are ignored. Unmatched unpinned memories are omitted; identical normalized memory texts are deduplicated. Whole memories only: even pins can be omitted when they exceed the allowance. Use specific tags or pins when lexical matching misses a relevant concept; this is not semantic retrieval.

Counts use `ceil(UTF-8 bytes / 4)`, not the provider tokenizer. They are approximate, especially for code and non-English text. The baseline is the same compiled instructions plus all enabled project memories, not a measured previous conversation. Savings are an input-context comparison, not a guaranteed reduction in total billed tokens, latency, or internal thinking. Smaller briefs can lose useful context: inspect the preview. Output caps include reasoning tokens, so a very low cap can truncate or leave no visible answer.

## Direct API costs and privacy

The direct integration uses the OpenAI Responses API and `gpt-6-luna`, with standard service tier, no external tools, `store: false`, and none/low/medium reasoning effort. Availability depends on the user's API account. Portable exports are provider-independent; direct execution currently supports OpenAI only.

**API billing is separate from an existing chat subscription.** The app shows estimated input cost, full generation-allowance cost, and total **additional API cost compared with $0 local export**, before consent. An estimate is not a financial spending cap. Provider usage, tokenization, cache writes, pricing changes, taxes, and account-specific billing may differ. Set provider-side budgets separately where available.

Published standard USD rates checked 2026-10-26: input $0.10/M tokens; cached input $0.01/M; cache writes $0.125/M; output $0.50/M. Source: https://developers.openai.com/api/docs/models/gpt-6-luna . Update `PRICING` in `core.mjs` when rates change. Historical records retain their calculated cost; they are not invoices. Reasoning tokens are already part of output usage and are not charged twice. Missing usage or unsupported service-tier information yields unknown cost, not zero. Timeouts can still incur provider charges; check provider usage before manually retrying.

Keys remain in the tab and the current server request's memory, never local state or project backups. Clear the key or close the tab when finished. Approving a request sends the compiled project profile, selected memories, and task to OpenAI. `store: false` does not promise zero retention under all provider policies. No conversation archives, Unity files, or external project folders are automatically read or uploaded.

Project profiles, memories, and usage are stored unencrypted. Executable mode uses `%LOCALAPPDATA%\ContextLoom\state.json`; source mode uses `data/state.json` beside the source files. Protect these directories. Exported JSON backups include private profiles and memories, not keys or usage history. Imports add independent copies with new IDs; they do not replace existing projects. Back up the data file separately if you need usage history. The application ships no sample project or credentials.

## Build and publish on GitHub

Use this folder as the root of a **separate Context Loom repository**. Do not upload the surrounding workspace, archives, authentication, `data/`, `node_modules/`, or `build/`.

The generated `release/context-loom-1.2.0-source.zip` contains an explicit allowlist of source files, including `.github/workflows/release.yml` and all nine language catalogs. Extract that archive and upload its contents to the repository root, including the hidden `.github` directory and `.gitignore`.

For an immediate manual release, create a GitHub Release and attach the executable, `LICENSE.txt`, `SHA256SUMS.txt`, and `THIRD-PARTY-NOTICES.txt` from `release/`. Large binaries belong in Release assets, not the source tree. Nothing in this build uploads or publishes automatically from your computer.

To build locally on Windows x64 with Node.js 24:

```sh
npm ci --ignore-scripts
npm test
npm run build:windows
npm run smoke:exe
```

Only the build requires development dependencies and internet access (to fetch the exact bundled Node runtime's license). Node's single-executable feature embeds the server, compiler, frontend assets, and runtime notices into the executable. The resulting app does not require installed dependencies or internet for local compilation.

GitHub Actions is configured for the separate repository root:

- **Actions → Build Windows download → Run workflow** builds and smoke-tests a downloadable workflow artifact; it does not create a Release.
- Pushing a tag matching `package.json`, such as `v1.2.0`, runs the same build and creates a **draft** GitHub Release with the artifacts unless a Release already exists for that tag. Existing Releases are left unchanged. Review and publish a new draft yourself. The workflow does not sign the executable.
- Update the package version and lockfile before tagging a new version. Generated build/release folders and private data are gitignored.

`CONTEXT_LOOM_DATA_DIR` overrides executable storage for isolated developer smoke runs. `--no-browser` prevents automatic browser opening during automation. Normal users do not need either option.

## Verification

```sh
node --test test/core.test.mjs
```

Eight behavioral regressions cover disabled-memory exclusion, zero budget including pins, relevance/stop-word filtering and deduplication, cached input charges, cache-write premiums, unknown costs, backward-compatible language settings, and CJK/Korean memory retrieval.

Delivery smoke checks exercised the running browser UI at desktop and 390px mobile widths: onboarding, persistence, isolated project switching, relevance omission, prompt export action, backup serialization/import, estimates, invalid-key errors, and stale-consent guards. Real local HTTP routes were also exercised with a simulated upstream response and timeout: billing calculation, consent/cost guards, cross-origin denial, no retries, credential non-persistence, and restart persistence. **No paid provider request was made; live account access and generation were not verified.**

Version 1.2.0 browser verification exercised all nine interface choices, onboarding draft preservation, an independent Japanese answer preference with Korean user text, localized cost/consent and technical-error presentation, locale restoration on reload, approval reset on language switching, failed/racing locale loads, and all nine mobile layouts at 390px. All catalogs contain the same 260 keys with matching interpolation placeholders. Translations are not certified professional translations; report wording issues through the repository.

The executable smoke runner additionally launches the actual `.exe` from a temporary directory with Node.js absent from `PATH`: embedded frontend assets, compilation, external private storage, duplicate-launch reuse, persisted-memory restart, and bundled license display are exercised. It makes no paid API calls and removes only its own temporary data. GitHub-hosted execution still requires uploading the repository and running its workflow; local verification is not proof of a hosted Actions run.

## Release notes

### 1.2.0 — 2026-10-26

- Nine interface languages with persisted preferences and draft-safe switching.
- Independent project answer-language preference, preserved in project backups.
- Multilingual memory matching, localized cost approval, validation, and launcher messages.


### 1.1.0 — 2026-10-26

- Standalone Windows x64 executable with bundled runtime/assets and automatic default-browser startup.
- Per-user application data, free-port selection, and single-instance reuse.
- Real executable smoke runner, checksums, runtime license notices, privacy-filtered source archive, and GitHub build/draft-release workflow.


### 1.0.0 — 2026-10-26

- Initial local web application with onboarding, scoped memories, deterministic context compilation, portable prompt exports, and private project backups.
- Opt-in OpenAI requests with explicit additional-cost estimates, per-request approval, output/reasoning controls, and usage-based accounting.
- Local-only binding, origin checks, atomic state saves, no persisted credentials, and no automatic paid retries.
