/* ============================================================
   CONFIG — this is the only file you need to edit.
   ============================================================ */

window.DECK_CONFIG = {

  /* 1. Your Firebase Realtime Database URL.
        Firebase console -> Realtime Database -> copy the URL at the top.
        Looks like one of these:
          https://your-project-default-rtdb.firebaseio.com
          https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app
        Leave "" to run the deck with live polls disabled (everything else works). */
  databaseURL: "https://idfc-astrology-ppt-default-rtdb.asia-southeast1.firebasedatabase.app/",

  /* 2. Session name. Change it (live-2, live-3, rehearsal...) to start
        with a clean, empty set of responses without deleting anything. */
  session: "live-1",

  /* 3. Audience URL for the QR codes.
        Leave "" and it is derived from wherever this page is hosted, which is
        what you want on GitHub Pages. Only set it if you need to override,
        e.g. "https://yourname.github.io/astro-deck". No trailing slash. */
  baseURL: "",

  /* 4. Shown on the title slide. */
  teamName: "Data & Analytics — New Joiners Cohort"
};
