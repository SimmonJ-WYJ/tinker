<a id="自定义模型中转站"></a>

# Custom Model Relays

Under "Settings → Model Configuration → Add Configuration," select:

- **Custom Relay · Anthropic**: The relay must support the Anthropic Messages API (`/v1/messages`).
- **Custom Relay · OpenAI**: The relay must support OpenAI Chat Completions (`/v1/chat/completions`). This version does not integrate the OpenAI Responses API.

Enter a name, Base URL, and API Key. The Base URL may be a root address, an address with a version path, or a complete Messages / Chat Completions address; the form previews the actual request endpoint. Do not include a key, account credentials, or query parameters in the URL.

First enter and enable a real model ID manually, or click "Refresh" to fetch the list from `/models` and enable a model; then "Test Connection." The test actually requests the model currently selected for the channel (very few tokens, potentially incurring provider usage). A relay without `/models` still supports manual model entry. Failed requests retain model input for editing and retrying; creation requires a successful connection test, and editing automatically saves after a successful test. Existing official provider configurations remain usable.

Agent requests for OpenAI channels undergo local protocol conversion, supporting text, images, tool calls and tool results, and streaming text. Once tool arguments are complete, they are passed to the Agent for execution. PDF document content blocks and provider-specific server-side tools cannot be passed through directly; PDF capability is disabled by default, and the application's PDF parsing tools can extract text. Do not enable PDF document capability for OpenAI channels. Actual capabilities still depend on the upstream model's image and tool support.

Known OpenAI reasoning models (o1/o3/o4, GPT-5 family) use `max_completion_tokens`; other compatible models use `max_tokens`. If a custom alias prevents identifying capabilities from the name, use the provider's standard model ID. Token budgets are approximate estimates and are not used for billing.

API Keys are encrypted with Electron safeStorage. The OpenAI bridge listens only on a random local port protected by random credentials; it is not exposed to browsers, and upstream keys are not passed to the Agent SDK subprocess. Relay model lists, connection probes, and OpenAI forwarding prohibit redirects to avoid forwarding credentials to unexpected addresses. Actual relay connectivity must be verified with your own valid configuration.
