<a id="生成图片预览与放大查看"></a>

# Generated Image Preview and Enlarged Viewer

Initial baseline: `c646b75b5b0ba8013a704ae3b497eb8d70454ef0`. Latest main `4b0ad6a4a951ca8fb234587eb1fec40c0b52d6c2` was integrated at submission. Reuse existing image versions and attachment structures on top of the previous three conversation image fixes; do not migrate the stack, modify real data, or replace the installed version.

<a id="用户行为与范围"></a>

## User Behavior and Scope

Users can already see generated images in the conversation, but Session Files on the right reports Preview failed, and some links produce no result when clicked. The goal is to open a closable, savable, zoomable original-image viewer by clicking an image, an unambiguously associated generated-image link, or a file card.

1. Right-side image previews read the original file path through the existing `previewReadBinary` bridge, then create a Blob URL. Avoid file URL escaping or renderer origin restrictions; add no file access permissions or IPC.
2. Intercept image links and artifact cards only when the current turn has a successful image-generation tool result, a current-session path, and a unique file reference. Full attachment paths distinguish images with the same name; do not guess from ambiguous bare filenames or substitute the latest image.
3. Other links, files, and unknown old tabs retain existing handling. Tabs previously pointing to an incorrect cwd cannot be automatically recovered from filenames alone; users must click an entry that unambiguously references the original image again.
4. The shared viewer supports fitting the window at the natural aspect ratio, zooming in/out, scrolling, saving, closing, and Escape; it does not edit, crop, or rewrite originals/versions. Keyboard +/-/0 zoom and reset.
5. Read failures show localized errors; precise references can be clicked again to retry. Rapid switching, session switching, and unmounting discard old reads; release Blob URLs on switching, unmounting, or decode failure. Closing the reference viewer clears extra base64 and retains no preview copy in historical turns.
6. Synchronize accessible names, focus return, and en/zh. Add only preview operation copy; do not address separately recorded billing approval or generation-card copy.

<a id="验收"></a>

## Acceptance

Use synthetic data to verify paths with special characters, missing files, corrupt images, unique/ambiguous/cross-session references, asynchronous races, resource release, reopening after closing, save callbacks, focus, and natural aspect ratios; run project type checking, all Bun tests, Electron builds, and ESLint for changed files. Verify display, interaction, and both languages in a native isolated Electron window and a 390px browser window. An isolated window does not constitute full installer acceptance.

<a id="回退"></a>

## Rollback

The user authorized GitHub submission; deliver through a separate fix branch and PR without changing the installed version. Retain the original working copy and backups. Project diagnostics retain complete relevant source snapshots, checksums, and a tracked patch. Review and revert this round's changes file by file while preserving prior user work; repository-wide reset/clean is forbidden.
