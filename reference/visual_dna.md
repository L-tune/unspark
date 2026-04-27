# Visual DNA references

## Tier-1 references (what to study)

**Linear** (linear.app)
- Why: tightest copy and typography in modern SaaS. Every word earns its place.
- Take from it: spacing rhythm, sentence-case headings, dark mode as default.

**Raycast** (raycast.com, also their app UI)
- Why: native macOS app that actually feels native, not Electron.
- Take from it: command-palette aesthetic, monospace accents, restrained accent color usage.

**Pixelmator Pro** (pixelmator.com/pro)
- Why: premium AI photo tool with proper macOS-native chrome.
- Take from it: tool window proportions, before/after compare patterns, vibrancy use.

**Topaz Photo AI** (topazlabs.com/topaz-photo-ai)
- Why: direct competitor in the AI image-cleanup space.
- Take from it: processing state UX (how they show "AI is working" without cliche).

## Tier-2 references (peripheral inspiration)

- **Apple's early iOS / iPad design** (iOS 7-10 era) — flat, declarative, generous whitespace
- **Frame.io** review tools — before/after slider patterns
- **Things 3** (culturedcode.com) — premium native macOS app feel, fixed-window-like layout
- **Cleanshot X** — drag-drop interface for Mac power users, similar workflow

## What to AVOID copying

- **Photoshop / Affinity** — too dense, too pro-tool, too many panels
- **Removebg.com / Watermarkremover.io** — generic SaaS web app aesthetics, hero-feature-cta layouts. We're an app, not a landing page.
- **DiffusionBee / ComfyUI** — too "developer tool" looking, too dark, too many sliders
- **Anything Material Design** — Google's design language, ironic mismatch with our anti-Gemini-watermark stance

## Sparkle icon reference

The 4-pointed star (✦) we're erasing has very specific geometry:
- 4 cusps at cardinal directions
- Deep concave arcs between cusps (waist radius ~10% of tip radius)
- Translucent white over background

For Unspark's OWN logo, we use the same shape but with the gradient stops (cyan → purple → pink) we extract from the watermark we're removing — using its colors against itself. This irony should be visually quiet, not loud.

Reference shape parameters (for the SVG):
```
tips at: (cx, cy-R), (cx+R, cy), (cx, cy+R), (cx-R, cy)  where R = 48% of size
valleys at: 45° between tips, radius 10% of size
fill: linearGradient (135deg) with 3 stops:
  0%   #4FC3F7
  50%  #9C27B0
  100% #FF6EC7
```

Optionally add subtle outer glow (blur 8px, opacity 0.3, same gradient) when on dark backgrounds.
