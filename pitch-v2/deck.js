/* ------------------------------------------------------------------ *
 * Underwrite pitch deck — navigation, presenter notes, rehearsal timer.
 *
 * Slides are laid out on a fixed 1600x900 stage and scaled to whatever
 * projector shows up, so nothing reflows between rehearsal and the room.
 * ------------------------------------------------------------------ */

(() => {
  const stage = document.getElementById("stage");
  const deck = document.getElementById("deck");
  const slides = Array.from(deck.querySelectorAll(".slide"));
  const notes = document.getElementById("notes");
  const notesHead = document.getElementById("notes-head");
  const notesBody = document.getElementById("notes-body");
  const notesNext = document.getElementById("notes-next");
  const hud = document.getElementById("hud");
  const clock = document.getElementById("clock");

  const TARGET_SECONDS = 4 * 60; // the demoday slot

  let index = 0;
  let gridMode = false;

  // ------------------------------------------------------------- rails

  slides.forEach((slide, i) => {
    const rail = document.createElement("div");
    rail.className = "rail";
    rail.innerHTML =
      `<span>${String(i + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}</span>` +
      slides.map((_, j) => `<span class="seg${j < i ? " done" : j === i ? " now" : ""}"></span>`).join("") +
      `<span>underwrite</span>`;
    slide.appendChild(rail);
    slide.addEventListener("click", () => {
      if (gridMode) {
        go(i);
        setGrid(false);
      }
    });
  });

  // ------------------------------------------------------------- scale

  const fit = () => {
    if (gridMode) return;
    const pad = 0;
    const k = Math.min((window.innerWidth - pad) / 1600, (window.innerHeight - pad) / 900);
    deck.style.setProperty("--k", k);
  };

  // ---------------------------------------------------------- playback

  /** Only the visible slide animates: restart its loop, freeze everyone else. */
  const syncMedia = () => {
    slides.forEach((slide, i) => {
      slide.querySelectorAll("video").forEach((v) => {
        if (i === index && !gridMode) {
          v.currentTime = 0;
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          v.pause();
        }
      });
    });
  };

  const renderNotes = () => {
    const slide = slides[index];
    const time = slide.dataset.time ? ` · alvo ${slide.dataset.time}` : "";
    notesHead.textContent = `${String(index + 1).padStart(2, "0")} ${slide.dataset.title || ""}${time}`;
    notesBody.innerHTML =
      "<ul>" +
      (slide.dataset.notes || "")
        .split("\n")
        .filter(Boolean)
        .map((l) => `<li>${l}</li>`)
        .join("") +
      "</ul>";
    const nxt = slides[index + 1];
    notesNext.textContent = nxt ? `a seguir → ${nxt.dataset.title}` : "último slide";
  };

  const go = (n) => {
    index = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => s.classList.toggle("is-on", i === index));
    location.hash = String(index + 1);
    renderNotes();
    syncMedia();
  };

  const setGrid = (on) => {
    gridMode = on;
    stage.classList.toggle("grid", on);
    if (on) {
      deck.style.removeProperty("--k");
    } else {
      fit();
    }
    syncMedia();
  };

  // ------------------------------------------------------------- timer

  let started = null;
  let ticking = null;

  const paint = () => {
    const s = started ? Math.floor((Date.now() - started) / 1000) : 0;
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    clock.classList.toggle("over", s > TARGET_SECONDS);
  };

  const toggleTimer = () => {
    if (ticking) {
      clearInterval(ticking);
      ticking = null;
      started = null;
    } else {
      started = Date.now();
      ticking = setInterval(paint, 250);
    }
    paint();
  };

  // ---------------------------------------------------------- controls

  const KEYS = {
    ArrowRight: () => go(index + 1),
    ArrowDown: () => go(index + 1),
    PageDown: () => go(index + 1),
    " ": () => go(index + 1),
    ArrowLeft: () => go(index - 1),
    ArrowUp: () => go(index - 1),
    PageUp: () => go(index - 1),
    Home: () => go(0),
    End: () => go(slides.length - 1),
    n: () => notes.classList.toggle("on"),
    g: () => setGrid(!gridMode),
    Escape: () => setGrid(false),
    t: toggleTimer,
    f: () =>
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  };

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const fn = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
      return;
    }
    if (/^[1-9]$/.test(e.key)) go(Number(e.key) - 1);
  });

  // Clicking forward is what happens with a borrowed clicker; keep it working.
  document.addEventListener("click", (e) => {
    if (gridMode || e.target.closest("#notes")) return;
    go(index + (e.clientX < window.innerWidth * 0.2 ? -1 : 1));
  });

  let hudTimer = null;
  window.addEventListener("mousemove", () => {
    hud.classList.add("on");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove("on"), 2200);
  });

  window.addEventListener("resize", fit);
  window.addEventListener("hashchange", () => {
    const n = Number(location.hash.slice(1));
    if (n && n - 1 !== index) go(n - 1);
  });

  fit();
  go(Number(location.hash.slice(1)) - 1 || 0);
  paint();
})();
