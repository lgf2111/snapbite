# Help screenshots

These are **real captures** from the phone, extracted from a screen recording of
the actual AI Studio flow (1290×2796, cropped and resized to 900 px wide). The
iPhone status bar is removed and personal data is blurred.

| File | Screen | Redacted |
| --- | --- | --- |
| `ai-studio-1.png` | Google sign-in (email entry) | none needed |
| `ai-studio-2.png` | AI Studio → API Keys, with **Create API key** top right | two other project names |
| `ai-studio-3.png` | **Create a new key** dialog, project dropdown open | none |
| `ai-studio-4.png` | **Create a new project** dialog | none |
| `ai-studio-5.png` | **API key details** with the copy icon | the key itself |

Step 6 in the panel ("paste it back in SnapBite") still uses a drawn diagram,
because no clean capture of that screen exists yet. Dropping
`ai-studio-6.png` here replaces it with no code change.

## How these were made

1. `ffmpeg` pulled frames at the timestamps where the flow changes.
2. macOS Vision OCR (`ocrbox.swift`) gave exact bounding boxes for text that had
   to go — no eyeballing pixel coordinates.
3. `magick` cropped the status bar, blurred those boxes, resized to 900 px.
4. OCR was re-run on the output and checked: the key, the email and the other
   project names must not appear.

Keep that verify step if you redo any of these. A blur that *looks* opaque can
still leave text readable, and re-running OCR is the cheap check — it is also
how the missing-plate-style failures get caught before they ship.
