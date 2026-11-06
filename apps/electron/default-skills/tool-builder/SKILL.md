---
name: tool-builder
description: Interactively create and manage Chat-mode custom HTTP tools. Use when the user wants to create a new API tool, configure a Chat tool, add a custom tool, manage custom tools, or says "帮我创建一个 XX 工具" / "create a tool for me". Also handles debugging, fixing, or removing existing custom tools.
version: "1.0.0"
category: default
---

# Tool Builder

Help the user create custom HTTP API tools for use in Chat mode through interactive dialogue.

## Workflow

### 1. Requirements Gathering

Ask the user about:
- Tool purpose (weather lookup, translation, exchange rate, etc.)
- API endpoint URL and authentication
- Required parameters (name, type, required or not)
- HTTP method (GET / POST)
- Which part of the response to extract

If the user is unsure which API to use, recommend a suitable public API.

### 2. Build the Configuration

Build the tool config JSON based on the gathered info. The config file is at `~/.asci/chat-tools.json`.

#### Config File Structure

```json
{
  "toolStates": {
    "memory": { "enabled": true },
    "web-search": { "enabled": false },
    "custom-weather": { "enabled": true }
  },
  "toolCredentials": {},
  "customTools": [
    {
      "id": "custom-weather",
      "name": "Weather Lookup",
      "description": "Look up the current weather for a given city",
      "params": [
        { "name": "city", "type": "string", "description": "City name", "required": true }
      ],
      "category": "custom",
      "executorType": "http",
      "httpConfig": {
        "urlTemplate": "https://wttr.in/{{city}}?format=j1",
        "method": "GET",
        "resultPath": "current_condition"
      }
    }
  ]
}
```

#### ChatToolMeta Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier; must use `custom-` prefix + slug format (e.g. `custom-weather`) |
| `name` | Yes | Display name |
| `description` | Yes | Tool description; the AI uses this to decide when to call it |
| `params` | Yes | Parameter list; each contains `name` / `type` / `description` / `required` |
| `category` | Yes | Fixed value `"custom"` |
| `executorType` | Yes | Fixed value `"http"` |
| `httpConfig` | Yes | HTTP request configuration |
| `icon` | No | Lucide icon name (e.g. `"Cloud"`, `"Languages"`) |
| `systemPromptAppend` | No | System-prompt snippet injected when the tool is enabled |

#### httpConfig Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `urlTemplate` | Yes | URL template; `{{paramName}}` placeholders are replaced with parameter values (auto URL-encoded) |
| `method` | Yes | `"GET"` or `"POST"` |
| `headers` | No | Request headers, typically for API-key auth: `{ "Authorization": "Bearer xxx" }` |
| `bodyTemplate` | No | POST-body JSON template; `{{paramName}}` placeholders are replaced (not encoded) |
| `resultPath` | No | Dot-path extracting a specific field from the response (e.g. `"data.results"`) |

#### Parameter Types

`params[].type` supports: `"string"` / `"number"` / `"boolean"`

Optionally add an `enum` field to constrain values:
```json
{ "name": "unit", "type": "string", "description": "Temperature unit", "enum": ["celsius", "fahrenheit"] }
```

### 3. Write the Configuration

Steps:
1. Read `~/.asci/chat-tools.json` (create if missing)
2. Append the new tool to the `customTools` array (dedupe by `id`)
3. Add `{ "enabled": true }` under `toolStates` so it's on by default
4. Write the file back (keep JSON formatted)

After writing, the app auto-detects the file change and refreshes the tool list.

### 4. Test Guidance

Tell the user:
- "The tool is created and enabled. Switch to Chat mode to test it."
- "You should see the new tool in the tool picker at the lower-left of the Chat input."
- "Try asking a question that needs this tool."
- "If anything is off, come back to Agent mode and let me know — I'll help you debug."

### 5. Debug and Fix

Common causes of user-reported issues:
- URL template wrong → fix `urlTemplate`
- Parameter mapping off → adjust `params` definition
- Response format changed → update `resultPath`
- Auth failure → check the API key in `headers`
- Timeout → check API reachability

After fixing, re-write `chat-tools.json` and the app auto-refreshes.

### 6. Delete a Tool

Remove the tool from the `customTools` array and remove its entry from `toolStates`.

## Full Example: Weather-lookup Tool

```json
{
  "id": "custom-weather",
  "name": "Weather Lookup",
  "description": "Look up current weather and temperature for a city. Call when the user asks about weather.",
  "params": [
    { "name": "city", "type": "string", "description": "City name (English)", "required": true }
  ],
  "category": "custom",
  "executorType": "http",
  "httpConfig": {
    "urlTemplate": "https://wttr.in/{{city}}?format=j1",
    "method": "GET",
    "resultPath": "current_condition"
  }
}
```

## Full Example: Translation Tool (POST + API Key)

```json
{
  "id": "custom-translate",
  "name": "Translate",
  "description": "Translate text into a target language. Call when the user wants translation.",
  "params": [
    { "name": "text", "type": "string", "description": "Text to translate", "required": true },
    { "name": "target_lang", "type": "string", "description": "Target language code", "required": true, "enum": ["EN", "ZH", "JA", "KO", "FR", "DE", "ES"] }
  ],
  "category": "custom",
  "executorType": "http",
  "httpConfig": {
    "urlTemplate": "https://api.example.com/translate",
    "method": "POST",
    "headers": { "Authorization": "Bearer YOUR_API_KEY" },
    "bodyTemplate": "{\"text\": \"{{text}}\", \"target_lang\": \"{{target_lang}}\"}",
    "resultPath": "translations.0.text"
  }
}
```
