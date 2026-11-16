<a id="tinker-三处接缝等距校准"></a>

# Equalize Tinker's Three Junction Gaps

Status: implemented and verified against private `SimmonJ-WYJ/tinker` main `c646b75`.

The user requested calibration of the gaps at the upper-left, right, and lower-left module junctions, an editable SVG, application icon replacement, and a push to GitHub. Screenshots were inaccessible locally, so positioning used the three module paths in the official A version and the user's description. Preserve all path contours, original lower-module proportions, wordmark, colors, canvas, and overall scaling; apply only local translations. The three components' translation vectors sum to zero to prevent overall center-of-gravity drift.

<a id="几何验收"></a>

## Geometric Acceptance

A gap is the minimum Euclidean distance between two adjacent filled contours, in local SVG logo coordinates. Independent Python/NumPy verification samples 500 points per quadratic curve; project tests sample 160, with a tolerance of 0.02.

| Junction | Original regular | Calibrated regular | Original Micro | Calibrated Micro |
| --- | ---: | ---: | ---: | ---: |
| Upper-left (upper/blue) | 26.08 | 18.00 | 39.12 | 26.00 |
| Right (upper/lower) | 6.07 | 18.00 | 20.58 | 26.00 |
| Lower-left (blue/lower) | 13.64 | 18.00 | 25.27 | 26.00 |

Micro retains wider whitespace: approximately 1px minimum at a 16px application icon and approximately 1.5px at 24px. The three gaps are equal within each of the regular and Micro versions.

<a id="更新范围与生成"></a>

## Update Scope and Generation

- Regular, black, white, Micro, horizontal wordmark, and application icon SVGs.
- Electron React inline SVG, compatible menu-bar SVG, and Template @1x/@2x/@3x.
- All 16/24/32/48/64/128/256/512/1024 PNGs, ICNS, and ICO.
- Rust frontend light/dark SVGs and Rust/prototype platform icons.
- `bun run apps/electron/scripts/generate-brand-icons.ts` now regenerates PNGs directly from SVGs, packages platform icons, and synchronizes application resources, preventing old PNGs from overwriting new source files.

<a id="验证与限制"></a>

## Verification and Limitations

- All 6 new icon tests passed, covering contour spacing, React/SVG consistency, and platform asset consistency.
- `bun test`: 3166 pass, 0 fail. Sandbox loopback-port restrictions initially caused 13 failures; all tests passed after local loopback services were allowed.
- Electron `build:renderer` passed; Rust frontend `build` and `typecheck` passed.
- Verified light/dark sidebar wordmarks and home graphics in the isolated Rust frontend copy through a browser. Did not launch or modify the user's existing desktop instance or test the Rust backend.
- Repository-wide `bun run typecheck` passed. Dependency links initially reused in the isolated copy pointed to the old development directory and reported an `AgentView.tsx:994` type error. Updating internal package links to the isolated copy resolved it without modifying that file.
- No installer was rebuilt; this does not establish that the user's installed application has updated.
- The original development directory and other threads' build directories remain unchanged. Used an independent clone in `/tmp`, excluding unrelated uncommitted changes.

Before/after comparison: [`before-after.png`](../logo-gap-review/before-after.png), with [`before-after.svg`](../logo-gap-review/before-after.svg) also retained.
