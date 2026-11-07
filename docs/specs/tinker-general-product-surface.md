# Tinker general product surface

Status: implemented; native installed-app end-to-end validation remains pending.

## Problem and behavior

Research-specific actions and setup steps distract from Tinker's general conversation, project, image and coding workflows. Hide those entry points while preserving existing data and shared tools.

- A single renderer policy hides the answer-level evidence-set action, research mention categories and root-menu library prefetch.
- Settings omit Zotero from primary navigation and omit the built-in Zotero/paper-search rows. User-configured MCP servers remain visible.
- Restore a previous Zotero settings location to MCP. Explicit legacy deep links remain available because OCR/ASR and cache controls share that page.
- Skip legacy Zotero onboarding substages with guarded advancement, including when Zotero is already running, without skipping the general task step.
- Replace research-first starter suggestions and project terminology in both languages. Suggestions only fill the draft; they do not execute a task or call an image API.
- Newly created default projects use a localized general name. Existing project names and indexes are unchanged.

## Preserved boundaries

Do not delete conversations, attachments, evidence records, databases, user-created connectors, credentials, or historical workflow handlers. PDF/Office parsing, OCR, ASR, file browsing, web search, models, images, coding and permission behavior remain available. Research runtime removal and extracting shared settings are separate follow-ups. Rust migration is paused and is not part of this change.

## Validation

Component regressions cover general starter suggestions, answer copy/feedback, settings navigation and recovery from a legacy research onboarding position. Locale key parity, workspace type checks, full tests and Electron build must pass on the submitted branch. Isolated browser component checks cover draft filling and language switching using synthetic data; they do not replace native installed-app validation.

## Rollback

Restore the renderer surface policy and revert this change's copy updates independently. No data migration or database rollback is needed. Previously configured services were not disabled.
