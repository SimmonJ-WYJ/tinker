<a id="独立生图能力"></a>

# Independent Image Generation Capability

The user approved adding image generation configuration, testing, Agent calls, image previews, and saving to ASCI.

- Add provider `custom-image`, reusing existing channel CRUD/encrypted configuration; keys never enter the model context.
- Image channels do not appear in the chat model selector or participate in chat model fallback.
- Endpoint: `/v1/images/generations`; use the model ID unchanged. Default to one image, with no automatic retries or automatic paid tests.
- Manual tests indicate that one image will be generated; failures display sanitized upstream error information.
- Register the Agent host tool independently, using enabled image channels/models; select the first by default, with model selection available in the user request. Reject duplicate concurrent calls.
- Currently supports text-to-image and base64 PNG/JPEG/WebP responses; do not proactively download arbitrary URLs, and explicitly reject link responses. Image-to-image, mask editing, and streaming previews are outside this scope.
- Save images in the session attachment directory; the tool returns only attachment information without writing large base64 payloads into session context. Display results directly at the session level rather than inside a collapsed process. Support zooming and Save As.
- Validation: boundary tests for image endpoints/model discovery/malicious responses, component tests proving paid probes do not run automatically, preview/save component tests, chat fallback isolation tests, typechecking, the full test suite, and packaging builds. Real upstream image generation requires separate acceptance using an actual key and a paid call.
