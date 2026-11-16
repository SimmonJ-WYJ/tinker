1. Super Agent Overview

Super Agent is Genspark's flagship feature, launched in April 2025: a nocode autonomous agent. Users describe a goal in one natural-language sentence, and Super Agent automatically plans tasks, chooses tools, and generates deliverables.

1.1 Underlying Architecture

 Coordinates 9 specialized large language models (later expanded to 30+ models)
 Integrates 80+ built-in tools (later expanded to 150+)
 Uses GPT4.1 for research and structured output (supports 1M-token context)
 Uses GPTimage1 for image generation
 Uses OpenAI Realtime API for real-time voice (Call For Me)
 Asynchronous cloud processing: tasks continue while users are offline

1.2 Super Agent's Core Value Proposition

"One prompt = one deliverable (or action)" — Super Agent moves users from typing in a conversation to receiving a finished result.

2. Overall Genspark Product Page Structure

2.1 Top-Level Entry and Navigation

Entering Genspark's main domain, genspark.ai, opens a unified AI workbench with a three-column layout: left navigation + central workspace + right artifact preview. The top contains global search and a user-avatar entry. Signed-out users can preview the home page, but triggering any Agent redirects to sign-in.

2.2 Input and Trigger Layer

The input stays at the bottom of the workspace and supports:
Text prompts + file attachments (PDF/Office/CSV/PPT/Image)
Direct sidebar shortcuts (explicit selection, bypassing routing)
Follow-up Suggestions after responses (3 to 4 pregenerated follow-up questions)
Mid-task checkpoint questions (quick-choice buttons appear when intent is unclear)

After triggering, Super Agent outputs routing labels in its response (such as [SLIDES] [SHEETS] [DOCS]); the frontend detects these and switches to the corresponding modality's generation endpoint.

2.3 Artifact Layer and Editing Modes

Artifacts fall into three categories:
Document (Slides / Sheets / Docs / Sparkpage): full embedded editor on the right, supporting AI Edit (conversational changes) + Advanced Edit (fine manual control); manual editing consumes no Credits
Media (Image / Video / Audio / Design): primarily regeneration, with weaker editing; supports parameter changes, style switching, and variant generation
Action (Developer / Call For Me): Developer outputs runnable code/previewable websites; Call For Me places real phone calls with a call-progress panel

Every artifact has a unified export/share bar: export native formats (PDF / PPTX / XLSX, etc.), generate public links, and copy to clipboard.

3. Follow Up (Follow-Up Questions)

3.1 Post-Response Followup Suggestions

After every response, Genspark automatically displays follow-up buttons beneath it (typically 34); each contains a complete follow-up prompt ready to click. This design pattern, Followup Suggestions, shifts conversation from user-led to system guidance + user choice, substantially increasing session depth and feature adoption.

3.2 Prompt Design for Follow-Up Generation (Reverse-Engineered with Claude)

This is the heart of the feature. A high-quality follow-up-generation prompt usually includes:

Element  Purpose
Role definition  "You are a conversation planner helping users explore topics in depth"
Input context  Combine the user's original question + the full AI response as model context
Count constraint  "Generate exactly 4 follow-up questions, no more and no fewer"
Diversity requirement  "The 4 questions should cover different directions: deeper detail, comparison, format transformation, and practical application" — crucial to avoiding repetitive questions
Format constraint  "Each follow-up should be a complete, directly sendable Chinese question beginning with the Chinese word for 'please,' 1540 characters"
Prohibitions  "Do not repeat what the user already asked; stay within the current topic"
Structured-output Schema  Enforce `{ followups: string[4] }` with JSON Schema to ensure reliable frontend parsing
