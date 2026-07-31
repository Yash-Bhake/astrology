# The Oldest Analytics Company in the World

A self-contained HTML presentation with live audience participation. No build step, no
dependencies, no CDN. Drop it on GitHub Pages and it works.

```
presentation/
├── index.html          the deck, you present this
├── respond.html        the audience page. QR codes point here
├── config.js           ← the only file you need to edit
├── assets/
│   ├── deck.css        theme (gold = belief, cyan = evidence)
│   ├── qr.js           QR encoder, written from scratch
│   └── live.js         Firebase client (REST + Server-Sent Events)
└── README.md
```

---

## 1. Set up Firebase (about 5 minutes, free, no card)

1. Go to **console.firebase.google.com** → **Add project**. Name it anything.
   You can turn Google Analytics off.
2. In the left sidebar: **Build → Realtime Database → Create Database**.
3. Pick a location (choose Singapore or Mumbai if offered, lower latency from India).
4. Choose **Start in test mode**. Click Enable.
5. Copy the URL shown at the top of the database page. It looks like:
   ```
   https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app
   ```
6. Paste it into **`config.js`** as `databaseURL`.

That's it. Nothing else to install.

### Security note, read this
Test mode leaves the database open to anyone with the URL, and it **expires after 30 days**.
That is fine for a 20-minute talk, but tighten it before the day by pasting this into
**Realtime Database → Rules**:

```json
{
  "rules": {
    "sessions": {
      ".read": true,
      ".write": "!data.exists() || newData.exists()"
    }
  }
}
```

This allows the deck to read responses and the audience to add them, but confines
everything to `/sessions`. Anyone with the link can still submit, which is exactly what
an audience poll needs. Don't put anything sensitive in this project.

---

## 2. Publish to GitHub Pages

```bash
cd presentation
git init && git add . && git commit -m "Astrology deck"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Source: main / (root)**. After a minute your deck is at:

```
https://<you>.github.io/<repo>/
```

**The QR codes derive their URL automatically** from wherever the page is hosted, so
there is nothing to update. If you ever need to override it, set `baseURL` in `config.js`.

> Opening `index.html` straight off your disk works for rehearsing, but the QR codes will
> encode a `file://` address that phones can't open. Use the hosted URL for the real thing.

---

## 3. Presenting

| Key | Does |
|-----|------|
| `→` `Space` `PgDn` `Enter` · or click | Next slide |
| `←` `PgUp` | Previous slide |
| `Home` / `End` | First / last slide |
| `F` | Fullscreen |
| `A` | Reveal the answer on the revenue-guess slide |
| `r` | Clear **this slide's** responses |
| `Shift + R` | Clear **all** responses in the current session |
| `?` | Keyboard help |

The bottom-right corner shows **live / reconnecting / offline** and the **session name**, so
you always know what you're pointed at. The slide number is in the URL, reload and you land
back on the same slide.

### Resetting responses

Three ways, from most to least surgical:

1. **`Shift + R`**, wipes every question in the current session. Asks first. The charts and
   word cloud go back to empty immediately; nobody needs to reload anything.
2. **`r`**, clears just the question on the slide you're standing on.
3. **Switch session**, add `?s=` to the URL and you get a completely fresh, empty set of
   responses without deleting anything:

   ```
   index.html?s=team-test     ← rehearse with your team
   index.html?s=dry-run-2     ← another clean run
   index.html                 ← the real thing (uses config.js: "live-1")
   ```

   **The session travels through the QR codes automatically**, so phones scanning during a
   `?s=team-test` rehearsal write into that session and can't contaminate the real one.
   This is the safest option on the day: rehearse on a throwaway session, then present on
   the clean default.

### The four audience moments

| Slide | QR sends them to | Shows up as |
|-------|------------------|-------------|
| 3 | Their "personalised" reading, rated 1–5 | Live bar chart + room average vs Forer's 4.26 |
| 12 | One word: what do you reach for when uncertain? | Live word cloud |
| 21 | Guess the revenue (4 options) | Live bars, then press `A` to reveal |
| 29 | Will you still check your horoscope? | Live bars, the closing proof |

**Before you present**, change `session` in `config.js` (`live-2`, `live-3`, …) to start
with an empty set of responses. Old sessions stay in the database untouched, so you can
rehearse as often as you like without polluting the real run.

---

## 4. If the internet fails on the day

The deck still runs. Every slide, animation and chart works offline, only the four live
polls go quiet, and they degrade to "waiting for the room…" rather than breaking. Fall back
to a show of hands and keep going; nothing else in the talk depends on it.

---

## Notes

- **The QR encoder is written from scratch** (`assets/qr.js`, byte mode, EC level M,
  versions 1–10) specifically so there is no CDN to fail on venue WiFi. It was validated
  against the `node-qrcode` reference implementation and by round-trip decoding, 614
  strings encoded and decoded back byte-for-byte, with every Reed-Solomon syndrome checked.
- **Nothing personal is stored.** The birth date, time and initial the audience enters never
  leave their phone; only the anonymous 1–5 rating is submitted.
- **The reading is Forer's 1948 paragraph**, identical for every person regardless of what
  they enter. That is the point of the demo.
- Every factual slide carries its citation along the bottom edge.
