# Website brief — Yekta Light product page

This folder lives in the site repo only as source material. Organize it into the site as you see fit; this file is the single source of truth for building the **Yekta Light** page on yektapour.com.
Everything a page needs is here: copy, features, downloads, media, brand, credits.
Use the text as written (it is final copy). Do not invent features that are not listed.

---

## 1. Product in one line

**Yekta Light — the 3D light color picker for painters.** Free. Photoshop + Clip Studio Paint.

Tagline options (pick one for the hero):
- *Paint with real light.*
- *Light it. Pick it.*

Short description (≈40 words):
> Yekta Light lets you light a real 3D form — a scanned head, a skull, a sphere — and pick the exact color the light creates: highlight, halftone, core shadow, reflected light. No more muddy shadows or guessed colors. Free for Photoshop and Clip Studio Paint.

The problem it solves (use as a short section):
- Muddy shadows?
- Guessing where the light falls?
- Skin that looks flat?
→ **Paint with real light.**

---

## 2. Features (final copy, grouped)

**Real 3D forms**
Male and female head scans, an anatomical skull, plus sphere, egg, cube, cylinder, cone, torus, drapery and an organic form. Five camera angles and Ortho / 85 / 50 / 35 mm lenses.

**Light like a photographer**
Drag the sun anywhere — in front, at the side or behind for rim light. One-click portrait setups: Rembrandt, Loop, Butterfly, Split, Rim, Under. Key and second light with real color temperature in Kelvin, sky light, ground bounce and rim light.

**Values first**
Notan (two values), three and five value groups, grayscale, and a same-value highlighter that shows every area with the value you picked. Planes mode turns any form into a faceted block-in.

**Pick lit color**
Click the form to get the physically lit color. Named light families — Highlight, Light, Halftone, Terminator, Core shadow, Reflected, Occlusion, Cast shadow, Rim — ready to paint. Pin the ones you love.

**Skin that breathes**
Subsurface scattering warms the terminator like real skin. Shadow tint pushes your shadows cool or warm without changing their value.

**Total color control**
Every color is editable: base, highlight, SSS, key light, second light, sky, bounce, rim, ground, shadow tint, environment reflections and the backdrop behind the form. Color wheel, HSV / RGB sliders, an OKLab color grid and 12 presets (Warm skin, Deep skin, Gold, Chrome, Glossy plastic, Matte clay, Plaster cast, Anime cel, Neon rim night, Sunset, Overcast, Campfire).

**No more mud**
A low-chroma warning flags colors that will read muddy — one click restores the color while keeping its value.

**Works where you paint**
Photoshop: a real panel — sets your foreground / background color, follows your foreground, adds colors to Swatches.
Clip Studio Paint: a floating window that stays on top, with a big palette for the CSP eyedropper (Windows and macOS).

**Fast and light**
Rendering is split into tiny slices, so Photoshop and Clip Studio never freeze. Nothing runs while you are not using it.

---

## 3. Downloads

All files are attached to the GitHub release **yekta-light-v2.0.0** of `yektapour/yekta-site` (release assets are not part of the website files, so they never affect the live site).
Use these exact links:

| Button label | Platform | Link |
|---|---|---|
| Download for Photoshop | Windows & macOS · Photoshop 2022 (23.3)+ | `https://github.com/yektapour/yekta-site/releases/download/yekta-light-v2.0.0/YektaLight.ccx` |
| Clip Studio — Windows | Windows 10/11, 64-bit | `https://github.com/yektapour/yekta-site/releases/download/yekta-light-v2.0.0/YektaLight-Windows.zip` |
| Clip Studio — Mac (Apple Silicon) | M1–M4 Macs, macOS 11+ | `https://github.com/yektapour/yekta-site/releases/download/yekta-light-v2.0.0/YektaLight-macOS-AppleSilicon.zip` |
| Clip Studio — Mac (Intel) | Intel Macs, macOS 11+ | `https://github.com/yektapour/yekta-site/releases/download/yekta-light-v2.0.0/YektaLight-macOS-Intel.zip` |

Guides (PDF) — link next to each download:

| Label | File in this repo |
|---|---|
| Install guide — Photoshop | `docs/YektaLight-Install-Photoshop.pdf` |
| Install guide — Clip Studio (Windows) | `docs/YektaLight-Install-ClipStudio-Windows.pdf` |
| Install guide — Clip Studio (macOS) | `docs/YektaLight-Install-ClipStudio-macOS.pdf` |
| User guide (every option explained) | `docs/YektaLight-User-Guide.pdf` |

Small print under the download buttons:
- Photoshop: double-click the .ccx file; Creative Cloud installs it. Then *Plugins ▸ Yekta Light*.
- Windows: Windows may show “Windows protected your PC” for new apps — click *More info ▸ Run anyway*.
- Mac: the app is not notarized yet — the install guide shows the one-time Terminal step.

---

## 4. Media (in this repo)

| File | Use |
|---|---|
| `media/YektaLight-walkthrough-16x9.mp4` | 2-min walkthrough — main video (desktop) |
| `media/YektaLight-walkthrough-9x16.mp4` | 60-s vertical cut — mobile / social |
| `media/poster-16x9.jpg`, `media/poster-9x16.jpg` | Video posters |
| `media/screenshots/top.png` | The panel: 3D view (hero image) |
| `media/screenshots/vp_color.png`, `vp_Notan.png`, `vp_5.png` | Color / Notan / 5-value comparison |
| `media/screenshots/heads-value-modes.png` | Heads and skull in value modes |
| `media/screenshots/toolbars.png`, `families.png`, `big.png` | UI details |
| `media/screenshots/sec_*.png` | Settings sections (light, material, color, grid, presets) |
| `media/icon-96.png` | App icon |

Copy the media files into the website's own assets folder and serve them from the site (do not hotlink raw GitHub files — raw.githubusercontent.com is not meant for video streaming).

---

## 5. Brand (match the tool)

- Mood: dark "darkroom", minimal, one warm accent (the light).
- Colors: background `#0c0c0d` / panel `#141415` / surface `#1b1b1d`; text `#ebe8e2`; muted `#8a8780`; lines `#2b2b2f`; **accent `#f3b44a`** (amber light). Accent text on accent buttons: `#1a1408`.
- Type: **Inter** (800 for headlines, 300–400 for body); monospace for HEX values.
- Logo: an amber glowing dot + **YEKTA** (800, letter-spacing 0.2em) + *light* (300, muted). Use text, not an image.
- Section labels: small uppercase, letter-spaced, amber, numbered (`01 — LIGHT IT`).

Suggested page structure:
1. Hero — logo, tagline, short description, primary "Download free" button, video (16:9).
2. Problem → "Paint with real light."
3. Feature grid (section 2 above) with screenshots.
4. Downloads (section 3) + guides.
5. Credits (section 6) and a small "Free" badge.

---

## 6. Credits (required — must appear on the page)

- Male head: “Lee Perry-Smith” head scan © Infinite-Realities — licensed **CC BY 3.0** (attribution required).
- Female head: “Woman’s Head” by Artur Loewental (plaster, The Collection, Lincoln), scan from Three D Scans (threedscans.com) by Oliver Laric — published without copyright restrictions.
- Skull: by Vladimir Petkovic, Khronos glTF Sample Assets — CC0.

---

## 7. Facts — do not change

- Price: **free**.
- Version: **2.0**.
- Photoshop: Photoshop 2022 (23.3) or newer, Windows and macOS.
- Clip Studio Paint: separate always-on-top app (Clip Studio does not support third-party panels); Windows 10/11 64-bit, macOS 11+ (Apple Silicon and Intel).
- Website: yektapour.com
