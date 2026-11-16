<a id="模型与渠道设置"></a>

# Model and Channel Settings

Status: Implemented according to the two confirmed designs; existing channel data and model routing are preserved.

- Given configured text and image-generation channels, opening model and channel settings displays them under "Language Conversation" and "Image Generation" respectively. Clicking a channel's body opens editing in the same window; the separate switch only enables/disables it.
- On the edit page, prioritize placing configuration name and type side by side; place endpoint preview below the address, connection testing beside the key, and results underneath. Refresh and manual model entry remain available. Show the image-generation protocol directly in connection information; place priority, reference-image settings, and PDF capability under advanced settings.
- Given a valid edited configuration, clicking Save waits for persistence before returning to the list. Image-generation configurations send a test-image request only when the user clicks Test.
- Remove the top brand area from the workbench sidebar; preserve branding on the homepage and login page.
