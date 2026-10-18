# Design audit and redesign (2026-10-15)

Scope: the website and the Android app (the app shows the same web interface). Method: a heuristic review
(usability heuristics and WCAG 2.2 AA) of every main screen, then browser checks after each change in the desktop
app's built-in browser at about 800 px and in 375 × 812 mobile emulation, plus keyboard, reduced-motion and contrast
checks. Findings that came up during the redesign's own QA are listed too, with their fixes.

## Overall impression before the redesign

SOMM was clear, honest and accessible, but visually quiet: flat navy panels, one accent colour and a static 2D map.
The Music Map — the product's signature — could not be explored in depth, shown full screen or saved. Getting music
in was the hardest step, and the most practical route (an external export tool) was not mentioned.

## Findings

Severity: 🔴 blocks a user goal · 🟡 noticeable friction · 🟢 polish

| # | Area | Finding | Severity | Resolution |
| --- | --- | --- | --- | --- |
| 1 | Music Map | No way to explore in 3D, go full screen, change the label size or save the map as an image. | 🔴 | 3D canvas view (rotate, tilt, zoom, pan, pinch, twist, keyboard), depth, camera angles, spin, layers, full screen, a text-size slider, and a *Sound of My Mind* poster export in four orientations with the logo and @handle under the map. |
| 2 | Getting music in | Most apps cannot export playlists; no guidance pointed to a tool that can. The converter was not in the main navigation. | 🔴 | A large guide to exporting with TuneMyMusic on the landing, Convert and Import pages; Convert added to the navigation and the user menu; CSVs holding several playlists are split into one CSV each. |
| 3 | Visual identity | Flat surfaces, a single accent and no motion made the product feel generic for a music app. | 🟡 | Liquid-glass surfaces, holographic Y2K accents (cyan, violet, magenta), Unbounded display type with Space Grotesk for UI text, an aurora backdrop, a live 3D map in the hero, a genre ticker, scroll reveals, tilt cards, magnetic buttons, a cursor glow and page transitions. |
| 4 | Touch | Small buttons were 36 px tall. | 🟡 | 44 px on touch screens; map toolbar controls are 44 px everywhere. |
| 5 | Map labels | Labels in dense areas overlapped or disappeared. | 🟡 | The 3D renderer places labels by priority without overlaps and tries other sides before dropping one; the poster fits the map *and* its labels into the frame, so larger text shrinks the map instead of cutting labels. The 2D view keeps its previous labelling. |
| 6 | Mobile | Tab strips showed a heavy scrollbar; the map toolbar took three rows on a phone. | 🟢 | Thin scrollbars; on phones both sliders share one row, buttons show icons with screen-reader text, and labels scale down on small screens. |
| 7 | Consistency | Some colours were hard-coded. | 🟢 | New tokens (`--cyan`, `--violet`, `--magenta`, `--mint`, `--holo`, `--chrome`, glass variables); contrast tests cover the new pairs. |

### Found during the redesign's QA, and fixed

* The poster's map area was cleared to transparent before drawing, which would have saved a PNG with a see-through
  map. A regression test now checks that drawing never clears the poster.
* Long outer labels were cut off at the poster edge; framing is now label-aware.
* The glass input style removed the drop-down arrows of select boxes (it reset `background-image`).
* Entrance animations kept a final transform and blur, which would have trapped the full-screen map and dialogs
  inside their parent; they now only animate in (`animation-fill-mode: backwards`).
* A background on `<html>` hid the aurora layer behind the body's background.
* In full screen the *Save my map* dialog was rendered outside the full-screen element, so it was invisible; it now
  opens inside the map stage.
* Under React's development StrictMode the 3D map stopped drawing after the double mount.
* Four-card sections wrapped as three plus one; they now use four, two or one columns.

### Found on real phones after launch, and fixed (2026-10-18)

* In the Android app the top bar sat under the status bar (Sign up next to the battery icon): the page requested
  `viewport-fit=cover` without padding for it. Removed; the window is padded natively and safe-area insets are respected.
* The account menu was a translucent panel anchored to a small button: hard to read over the map and cramped on
  phones. It is now an opaque sheet with large (50 px) rows on phones.
* The member *More* panel was clipped by its row and could hide behind the tab bar; it now opens inline.
* The chat box was squeezed to a few characters by the share buttons on 360 px screens; it now takes its own row.

## What worked and was kept

* Every statement about a listener's taste shows its evidence and source; nothing in the redesign hides that.
* The list view and the keyboard-operable 2D map remain the screen-reader-friendly ways to explore the map.
* The copy stays plain and honest (for example, provider limits are stated, never faked).

## Accessibility after the redesign

* **Contrast:** WCAG AA (≥ 4.5 : 1) for all tested token pairs, including the new accent colours on the background
  (`tests/ui/contrast.test.ts`).
* **Reduced motion:** with *reduce motion* set, decorative animation is off, nothing is hidden waiting for a scroll
  reveal, the 3D map neither spins nor plays its intro, and page transitions are instant.
* **Keyboard:** the 3D map is focusable (arrow keys rotate and tilt, + and − zoom, 0 resets, Escape clears the
  selection); the poster dialog traps focus, closes with Escape and returns focus.
* **Screen readers:** the 3D canvas has a text summary of the largest genre families and the controls; every
  control, including icon-only toolbar buttons and the sliders, has an accessible name.
* **Targets:** 44 px for the map toolbar and for small buttons on touch screens.

## Known gaps

* The 2D map still has no label collision handling (the 3D view, which is now the default, does).
* Visual checks were manual in one Chromium-based browser; there are no automated cross-browser screenshots.
* Element full screen is unavailable on iPhone Safari and is not used in the Android app; both use the in-page full
  screen.
