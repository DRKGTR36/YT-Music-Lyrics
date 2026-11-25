# Project Handoff: YTM Dual Column Lyrics (`v2.0.2`)

**Tanggal:** 25 November 2026  
**Target Platform:** Google Chrome / Chromium (Manifest V3) — `https://music.youtube.com/*`  
**Status:** Stabil (Tab Lyrics + Fullscreen Subtitle Overlay + Auto-Hide Player Bar + DOM Fallback)

---

## 1. Ringkasan Proyek & Tujuan
Ekstensi Chrome berbasis Manifest V3 untuk menggantikan tampilan lirik statis bawaan YouTube Music menjadi tampilan lirik dinamis yang tersinkronisasi dengan waktu pemutaran audio/video (`<video>`), dilengkapi:
1. **Tab Lirik Dinamis (Normal View):** Jendela 7 baris berpusat di tengah (*centered window*), indikator jeda instrumental (`♫`), klik-baris untuk *seek*, serta pengaturan manual *offset/delay* (`-0.5s`, `0.0s`, `+0.5s`) yang tersimpan per lagu di `chrome.storage.local`.
2. **Fullscreen Subtitle Overlay:** Lirik melayang di bagian bawah layar penuh dengan mode 2 baris (**1 baris sebelumnya yang sudah lewat tampil redup di atas + 1 baris aktif putih terang di bawahnya**, sementara **baris setelahnya disembunyikan** agar tidak mengganggu visual MV).
3. **Fullscreen Auto-Hide Player Bar:** Kontrol navigasi bawaan YouTube Music (`ytmusic-player-bar`) disembunyikan otomatis saat mode layar penuh, dan hanya muncul kembali saat kursor diarahkan (*hover*) ke area bawah layar.
4. **Resilient Lyrics Fetching & Fallback:** Menggunakan **LRCLIB API** sebagai sumber utama (*synced* maupun *plain*), dengan **DOM Fallback** ke teks lirik bawaan YouTube Music (`ytmusic-description-shelf-renderer`) jika LRCLIB kosong/gagal.

---

## 2. Struktur File Ekstensi

```text
YT MUSIC LYRICS/
├── manifest.json     # Konfigurasi Manifest V3, permissions, dan content scripts
├── background.js     # Service Worker untuk fetch LRCLIB API (bypass CORS page)
├── content.js        # Core logic: DOM observer, parser LRC, timeline, sync, & fullscreen UI
└── styles.css        # Styling tab lirik, fullscreen overlay, animasi transisi, & hover nav
```

---

## 3. Kronologi Perubahan & Bug Fixes

| Tahap | Perubahan / Masalah | Solusi yang Diterapkan |
| :--- | :--- | :--- |
| **1. Base Tab Lyrics** | Tampilan 7 baris (`MAX_VISIBLE_LINES = 7`), hint teks atas dikomentari agar lebih minimalis. | Mempertahankan window 7 baris terpusat dengan *manual browsing* saat di-scroll user selama 4 detik. |
| **2. Fullscreen Overlay** | Lirik belum muncul di mode layar penuh. | Menambahkan `#ytm-fs-lyrics-overlay` yang terpasang ke `document.fullscreenElement` / `ytmusic-player-page`, lengkap dengan tombol toggle `Lirik: ON/OFF` dan kontrol offset di pojok kanan atas. |
| **3. Subtitle Line Filtering & Hover Nav** | Tampilan lirik sesudah baris aktif mengganggu MV, dan *player bar* bawah selalu tampil menutupi layar. | Menyembunyikan baris `index > centerIdx` (`is-fs-hidden`), menampilkan `index === centerIdx - 1` (`is-fs-prev`) di atas baris aktif (`is-fs-active`), serta menambahkan `body.ytm-fs-active-mode` + `#ytm-fs-bottom-hover-zone` untuk *auto-hide* `ytmusic-player-bar`. |
| **4. Native Lyrics Overlap & API Fallback** | Pada lagu tertentu (mis. *These Walls* - Dua Lipa), LRCLIB gagal/kosong atau lirik statis bawaan YTM muncul terlambat dan menimpa UI ekstensi. | 1) Menambahkan CSS `:has(#ytm-lyric-tab-host.is-visible)` dengan `display: none !important` + *re-check* 250ms pada `syncShelfChildrenVisibility()`.<br>2) Membatalkan `api.lyrics.ovh` (sering *down* & invalid host pattern `/*` di MV3) dan menggantinya dengan `extractNativeDomLyrics()` untuk membaca teks lirik bawaan YTM secara lokal lalu menghitung *estimated timings*. |

---

## 4. Arsitektur Teknis (`content.js`)

### A. Alur Pengambilan & Pemrosesan Lirik
1. **Deteksi Lagu (`getTrackInfo`):** Membaca `.title`, `.byline` pada `ytmusic-player-bar`, serta parameter query `?v=` dari URL untuk membentuk `activeTrackKey` (`${videoId || title}__${title}__${artist}`).
2. **Pembersihan Metadata (`cleanSearchTitle` & `cleanSearchArtist`):** Menghapus embel-embel seperti `(Official Video)`, `(Official Audio)`, `(Lyric Video)`, `[...]`, `(feat. ...)`, dan `- Topic`.
3. **Pencarian LRCLIB (`fetchSyncedLyricsForTrack`):** Mengirim pesan `FETCH_LRCLIB_SEARCH` ke `background.js`. Kandidat *synced lyrics* dipilih berdasarkan selisih durasi terdekat dengan `<video>.duration` (`pickBestSyncedCandidate`), termasuk penyesuaian *intro shift* otomatis (3–20 detik).
4. **Fallback Lirik Bawaan (`extractNativeDomLyrics`):** Jika LRCLIB tidak mengembalikan hasil *synced* maupun *plain*, script mengambil teks dari elemen deskripsi/lirik bawaan YouTube Music dan memetakannya ke timestamp estimasi berbasis bobot panjang karakter (`buildEstimatedTimings`).
5. **Pembangunan Timeline (`buildCleanTimeline`):** Menyisipkan segmen instrumental (`♫`) apabila jeda intro $\ge 7.0\text{s}$ atau jeda antarbaris $\ge 9.5\text{s}$.

### B. Sinkronisasi & Manajemen State
* **Loop & Event:** Menggunakan kombinasi *event listener* `<video>` (`timeupdate`, `seeked`), `fullscreenchange`, `click` (delegated capture), dan *polling interval* setiap `1500ms`.
* **Penyimpanan Persisten (`chrome.storage.local`):**
  * `ytmTrackOffsets`: Map `{ [trackKey]: offsetSec }` (maksimal 200 entri).
  * `ytmFsLyricsEnabled`: Boolean status `Lirik: ON/OFF` di layar penuh.

---

## 5. Kode Sumber Lengkap (Current State)

### 5.1. `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "YTM Dual Column Lyrics",
  "version": "2.0.2",
  "description": "Synced lyrics with instrumental breaks, duet styling, fullscreen subtitles, and source credits for YouTube Music.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://music.youtube.com/*",
    "https://lrclib.net/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://music.youtube.com/*"],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    }
  ]
}
```

### 5.2. `background.js`
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "FETCH_LRCLIB_SEARCH") return false;

  const { trackName, artistName } = message;
  const params = new URLSearchParams({
    track_name: trackName || "",
    artist_name: artistName || ""
  });

  fetch(`https://lrclib.net/api/search?${params.toString()}`)
    .then(async (res) => {
      if (!res.ok) {
        sendResponse({ ok: false, candidates: [] });
        return;
      }
      const data = await res.json();
      sendResponse({
        ok: true,
        candidates: Array.isArray(data) ? data : []
      });
    })
    .catch(() => {
      sendResponse({ ok: false, candidates: [] });
    });

  return true;
});
```

### 5.3. `content.js`
```javascript
(() => {
  "use strict";

  const isEnabled = true;
  const MAX_VISIBLE_LINES = 7;

  let activeTrackKey = "";
  let renderedTrackKey = "";
  let lyricItems = [];
  let fsLyricItems = [];
  let activeIndex = -1;
  let lastWindowStart = -1;
  let trackOffsetSec = 0;
  let lastTabSelected = false;
  let pollTimer = null;
  let syncedLyricsCache = new Map();
  let savedOffsetsMap = {};
  let fetchInFlightKey = "";
  let boundVideoEl = null;
  let userScrolledAt = 0;
  let fsLyricsEnabled = true;

  const PAUSE_CONFIG = {
    introMinGapSec: 7.0,
    midMinGapSec: 9.5,
    vocalHoldBeforeBreakSec: 3.2,
    minBreakWidthSec: 4.5,
    sectionShiftGapSec: 7.5
  };

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["ytmTrackOffsets", "ytmFsLyricsEnabled"], (res) => {
      if (res && typeof res.ytmTrackOffsets === "object" && res.ytmTrackOffsets !== null) {
        savedOffsetsMap = res.ytmTrackOffsets;
        if (activeTrackKey && typeof savedOffsetsMap[activeTrackKey] === "number") {
          trackOffsetSec = savedOffsetsMap[activeTrackKey];
          updateOffsetUI();
          syncHighlight(true);
        }
      }
      if (res && typeof res.ytmFsLyricsEnabled === "boolean") {
        fsLyricsEnabled = res.ytmFsLyricsEnabled;
        updateFsToggleUI();
      }
    });
  }

  function persistTrackOffset(key, offsetVal) {
    if (!key) return;
    if (Math.abs(offsetVal) < 0.05) {
      delete savedOffsetsMap[key];
    } else {
      savedOffsetsMap[key] = Number(offsetVal.toFixed(2));
    }

    const keys = Object.keys(savedOffsetsMap);
    if (keys.length > 200) {
      delete savedOffsetsMap[keys[0]];
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ytmTrackOffsets: savedOffsetsMap });
    }
  }

  function formatSec(secVal) {
    if (!isFinite(secVal) || secVal < 0) return "0:00";
    const total = Math.floor(secVal);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function getVideoEl() {
    const videos = document.querySelectorAll("video");
    if (!videos.length) return null;
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!v.paused && isFinite(v.duration) && v.duration > 0) return v;
    }
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (isFinite(v.duration) && v.duration > 0) return v;
    }
    return videos[0];
  }

  function getVideoIdFromUrl() {
    try {
      return new URL(window.location.href).searchParams.get("v") || "";
    } catch {
      return "";
    }
  }

  function getTrackInfo() {
    const titleEl = document.querySelector("ytmusic-player-bar .title");
    const bylineEl = document.querySelector("ytmusic-player-bar .byline");

    const title = titleEl ? titleEl.textContent.trim() : "Unknown Track";
    const rawByline = bylineEl ? bylineEl.textContent.trim() : "";
    const artist = rawByline.split("•")[0].trim() || "Unknown Artist";
    const videoId = getVideoIdFromUrl();

    return { title, artist, videoId };
  }

  function cleanSearchTitle(title) {
    return title
      .replace(/\(official\s*(music\s*)?video\)/gi, "")
      .replace(/\(official\s*audio\)/gi, "")
      .replace(/\(lyric\s*video\)/gi, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\(feat\.[^)]*\)/gi, "")
      .replace(/\(ft\.[^)]*\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanSearchArtist(artist) {
    return artist
      .replace(/\s*-\s*Topic$/i, "")
      .split(",")[0]
      .split("&")[0]
      .trim();
  }

  function parseLRC(lrcText) {
    if (!lrcText || typeof lrcText !== "string") return [];
    const lines = [];
    const regex = /\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)/;

    for (const rawLine of lrcText.split(/\r?\n/)) {
      const match = rawLine.match(regex);
      if (!match) continue;

      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const frac = match[3] || "0";
      const ms = parseInt(frac.padEnd(3, "0").slice(0, 3), 10);
      const text = (match[4] || "").trim();

      if (text) {
        lines.push({
          time: min * 60 + sec + ms / 1000,
          text
        });
      }
    }

    return lines.sort((a, b) => a.time - b.time);
  }

  function pickBestSyncedCandidate(candidates, targetDuration) {
    const withSynced = candidates
      .map((item) => ({
        ...item,
        parsed: parseLRC(item.syncedLyrics || "")
      }))
      .filter((item) => item.parsed.length >= 2);

    if (withSynced.length === 0) return null;

    if (!targetDuration || !isFinite(targetDuration) || targetDuration <= 10) {
      return withSynced[0];
    }

    withSynced.sort((a, b) => {
      const diffA = typeof a.duration === "number" ? Math.abs(a.duration - targetDuration) : 9999;
      const diffB = typeof b.duration === "number" ? Math.abs(b.duration - targetDuration) : 9999;
      return diffA - diffB;
    });

    const best = withSynced[0];
    if (typeof best.duration === "number" && Math.abs(best.duration - targetDuration) > 30) {
      return null;
    }

    if (typeof best.duration === "number") {
      const introShift = targetDuration - best.duration;
      if (introShift >= 3 && introShift <= 20) {
        best.parsed = best.parsed.map((line) => ({
          ...line,
          time: line.time + introShift
        }));
      }
    }

    return best;
  }

  function extractCreditsFromCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") return "";
    const parts = [];
    if (candidate.artistName) parts.push(`Artist: ${candidate.artistName}`);
    if (candidate.albumName) parts.push(`Album: ${candidate.albumName}`);
    return parts.join(" • ");
  }

  function extractNativeDomLyrics(shelf) {
    if (!shelf) return [];
    const selectors = [
      "yt-formatted-string.description",
      "#description yt-formatted-string",
      "ytmusic-lyric-renderer yt-formatted-string",
      ".non-expandable.description"
    ];

    for (const sel of selectors) {
      const els = shelf.querySelectorAll(sel);
      for (const el of els) {
        if (el.closest("#ytm-lyric-tab-host")) continue;
        const raw = (el.textContent || "").trim();
        const lines = raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          return lines;
        }
      }
    }
    return [];
  }

  async function fetchSyncedLyricsForTrack(key, title, artist, durationSec) {
    if (syncedLyricsCache.has(key)) {
      return syncedLyricsCache.get(key);
    }
    if (fetchInFlightKey === key) {
      return null;
    }

    fetchInFlightKey = key;
    const cleanTitle = cleanSearchTitle(title);
    const cleanArtist = cleanSearchArtist(artist);

    try {
      const response = await new Promise((resolve) => {
        if (!chrome?.runtime?.sendMessage) {
          resolve({ ok: false, candidates: [] });
          return;
        }
        chrome.runtime.sendMessage(
          {
            type: "FETCH_LRCLIB_SEARCH",
            trackName: cleanTitle,
            artistName: cleanArtist
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, candidates: [] });
              return;
            }
            resolve(res || { ok: false, candidates: [] });
          }
        );
      });

      const candidates = response.ok && Array.isArray(response.candidates) ? response.candidates : [];
      const bestSynced = pickBestSyncedCandidate(candidates, durationSec);
      const plainSource = bestSynced || candidates.find((c) => c.plainLyrics);
      const chosenMeta = bestSynced || plainSource || null;

      let finalPlainLines = (plainSource?.plainLyrics || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      let finalSource = bestSynced
        ? "LRCLIB (Synced)"
        : finalPlainLines.length >= 2
          ? "LRCLIB (Plain)"
          : "None";

      if (!bestSynced && finalPlainLines.length < 2) {
        const shelf = document.querySelector("ytmusic-player-page ytmusic-description-shelf-renderer");
        const domLines = extractNativeDomLyrics(shelf);
        if (domLines.length >= 2) {
          finalPlainLines = domLines;
          finalSource = "YTM Fallback (Estimated)";
        }
      }

      const result = {
        synced: bestSynced ? bestSynced.parsed : null,
        plain: finalPlainLines,
        source: finalSource,
        credits: extractCreditsFromCandidate(chosenMeta)
      };

      if (syncedLyricsCache.size >= 50) {
        const oldestKey = syncedLyricsCache.keys().next().value;
        syncedLyricsCache.delete(oldestKey);
      }
      syncedLyricsCache.set(key, result);

      if (isEnabled && activeTrackKey === key) {
        renderedTrackKey = "";
        renderLyricsView(true);
      }
      return result;
    } catch {
      const shelf = document.querySelector("ytmusic-player-page ytmusic-description-shelf-renderer");
      const domLines = extractNativeDomLyrics(shelf);
      const fallbackResult = {
        synced: null,
        plain: domLines,
        source: domLines.length >= 2 ? "YTM Fallback (Estimated)" : "None",
        credits: ""
      };
      syncedLyricsCache.set(key, fallbackResult);
      return fallbackResult;
    } finally {
      if (fetchInFlightKey === key) {
        fetchInFlightKey = "";
      }
    }
  }

  function isLyricsTabSelected() {
    const tabs = document.querySelectorAll(
      "ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page [role='tab']"
    );
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const txt = (tab.textContent || "").trim().toUpperCase();
      if (txt === "LIRIK" || txt === "LYRICS") {
        return tab.getAttribute("aria-selected") === "true" || tab.hasAttribute("active");
      }
    }
    return false;
  }

  function isPlayerFullscreen() {
    if (document.fullscreenElement) return true;
    const playerPage = document.querySelector("ytmusic-player-page");
    if (playerPage && playerPage.hasAttribute("player-fullscreened")) return true;
    return false;
  }

  function syncFullscreenBodyState(active) {
    document.body.classList.toggle("ytm-fs-active-mode", Boolean(active));
  }

  function buildEstimatedTimings(lines, durationSec) {
    const totalDuration =
      durationSec && isFinite(durationSec) && durationSec > 10 ? durationSec : lines.length * 4;
    const startBuffer = Math.min(3, totalDuration * 0.02);
    const usableDuration = Math.max(10, totalDuration - startBuffer - 2);

    const weights = lines.map((line) => Math.max(line.length, 8));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    let cursor = startBuffer;
    return lines.map((text, idx) => {
      const item = { time: cursor, text };
      cursor += (weights[idx] / totalWeight) * usableDuration;
      return item;
    });
  }

  function buildCleanTimeline(timedLines) {
    if (!Array.isArray(timedLines) || timedLines.length === 0) return [];

    const segments = [];
    let shiftOnNextLine = false;

    if (timedLines[0].time >= PAUSE_CONFIG.introMinGapSec) {
      segments.push({
        rawTime: 0,
        startTime: 0,
        text: "♫",
        isInstrumental: true,
        isSectionShift: false,
        el: null
      });
    }

    for (let i = 0; i < timedLines.length; i++) {
      const curr = timedLines[i];
      const next = timedLines[i + 1];
      const prev = timedLines[i - 1];

      const gapFromPrev = prev ? curr.time - prev.time : 0;
      const shouldShiftBySectionGap = prev && gapFromPrev >= PAUSE_CONFIG.sectionShiftGapSec;
      const isSectionShift = i > 0 && (shiftOnNextLine || shouldShiftBySectionGap);
      shiftOnNextLine = false;

      segments.push({
        rawTime: curr.time,
        startTime: curr.time,
        text: curr.text,
        isInstrumental: false,
        isSectionShift,
        el: null
      });

      if (next && next.time - curr.time >= PAUSE_CONFIG.midMinGapSec) {
        const breakAt = curr.time + PAUSE_CONFIG.vocalHoldBeforeBreakSec;
        if (next.time - breakAt >= PAUSE_CONFIG.minBreakWidthSec) {
          segments.push({
            rawTime: breakAt,
            startTime: breakAt,
            text: "♫",
            isInstrumental: true,
            isSectionShift: false,
            el: null
          });
          shiftOnNextLine = true;
        }
      }
    }

    return segments;
  }

  function updateOffsetUI() {
    const valueEl = document.getElementById("ytm-offset-value");
    const statusEl = document.getElementById("ytm-sync-readout");
    const fsOffsetEl = document.getElementById("ytm-fs-offset-val");
    const video = getVideoEl();

    const sign = trackOffsetSec > 0 ? "+" : "";
    const offsetStr = `${sign}${trackOffsetSec.toFixed(1)}s`;

    if (valueEl) valueEl.textContent = offsetStr;
    if (fsOffsetEl) fsOffsetEl.textContent = offsetStr;

    if (statusEl) {
      const audioSec = video && isFinite(video.currentTime) ? video.currentTime : 0;
      const hintLabel =
        trackOffsetSec > 0
          ? `Lirik maju ${offsetStr}`
          : trackOffsetSec < 0
            ? `Lirik mundur ${offsetStr}`
            : "Pas (0.0s)";
      statusEl.textContent = `${formatSec(audioSec)} • ${hintLabel}`;
    }
  }

  function updateFsToggleUI() {
    const toggleBtn = document.getElementById("ytm-fs-toggle-btn");
    const stage = document.getElementById("ytm-fs-stage");
    if (toggleBtn) {
      toggleBtn.textContent = fsLyricsEnabled ? "Lirik: ON" : "Lirik: OFF";
      toggleBtn.classList.toggle("is-off", !fsLyricsEnabled);
    }
    if (stage) {
      stage.classList.toggle("is-collapsed", !fsLyricsEnabled);
    }
  }

  function toggleFullscreenLyrics() {
    fsLyricsEnabled = !fsLyricsEnabled;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ytmFsLyricsEnabled: fsLyricsEnabled });
    }
    updateFsToggleUI();
  }

  function adjustTrackOffset(delta) {
    trackOffsetSec = Number((trackOffsetSec + delta).toFixed(1));
    persistTrackOffset(activeTrackKey, trackOffsetSec);
    userScrolledAt = 0;
    updateOffsetUI();
    activeIndex = -1;
    syncHighlight(true);
  }

  function resetTrackOffset() {
    trackOffsetSec = 0;
    persistTrackOffset(activeTrackKey, 0);
    userScrolledAt = 0;
    updateOffsetUI();
    activeIndex = -1;
    syncHighlight(true);
  }

  function setParentScrollLock(shelf, lockScroll) {
    if (!shelf) return;
    if (lockScroll) {
      if (!("ytmOrigOverflow" in shelf.dataset)) {
        shelf.dataset.ytmOrigOverflow = shelf.style.overflow || "";
      }
      shelf.style.overflow = "hidden";
    } else if ("ytmOrigOverflow" in shelf.dataset) {
      shelf.style.overflow = shelf.dataset.ytmOrigOverflow;
      delete shelf.dataset.ytmOrigOverflow;
    }
  }

  function syncShelfChildrenVisibility(shelf, hideNative) {
    if (!shelf) return;
    setParentScrollLock(shelf, hideNative);
    const children = shelf.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.id === "ytm-lyric-tab-host") continue;
      if (hideNative) {
        if (child.style.display !== "none") {
          child.dataset.ytmOrigDisplay = child.style.display || "";
          child.style.setProperty("display", "none", "important");
        }
      } else if (child.style.display === "none" && "ytmOrigDisplay" in child.dataset) {
        child.style.display = child.dataset.ytmOrigDisplay;
        delete child.dataset.ytmOrigDisplay;
      }
    }
  }

  function ensureHostNode() {
    let host = document.getElementById("ytm-lyric-tab-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "ytm-lyric-tab-host";
      host.innerHTML = `
        <div id="ytm-dual-lyrics" class="ytm-lyrics-pane"></div>
        <div class="ytm-bottom-dock">
          <div id="ytm-sync-readout" class="ytm-sync-readout">0:00 • Pas (0.0s)</div>
          <div id="ytm-dual-sync-bar" class="ytm-sync-bar" title="Atur delay lirik: (-) mundur, (+) maju">
            <button id="ytm-sync-minus" class="ytm-sync-btn" type="button" aria-label="Mundur 0.5 detik">-0.5s</button>
            <button id="ytm-offset-value" class="ytm-sync-val" type="button" title="Klik untuk reset ke 0.0s">0.0s</button>
            <button id="ytm-sync-plus" class="ytm-sync-btn" type="button" aria-label="Maju 0.5 detik">+0.5s</button>
          </div>
        </div>
      `;
      document.body.appendChild(host);

      host.querySelector("#ytm-sync-minus")?.addEventListener("click", () => adjustTrackOffset(-0.5));
      host.querySelector("#ytm-sync-plus")?.addEventListener("click", () => adjustTrackOffset(0.5));
      host.querySelector("#ytm-offset-value")?.addEventListener("click", resetTrackOffset);

      const pane = host.querySelector("#ytm-dual-lyrics");
      if (pane) {
        pane.addEventListener(
          "wheel",
          () => {
            userScrolledAt = Date.now();
            pane.classList.add("is-manual-browsing");
          },
          { passive: true }
        );
        pane.addEventListener("scroll", () => {
          if (Date.now() - userScrolledAt < 4000) {
            pane.classList.add("is-manual-browsing");
          }
        });
      }
    }
    return host;
  }

  function ensureFullscreenOverlay() {
    let overlay = document.getElementById("ytm-fs-lyrics-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ytm-fs-lyrics-overlay";
      overlay.innerHTML = `
        <div class="ytm-fs-hud">
          <button id="ytm-fs-toggle-btn" class="ytm-fs-pill-btn" type="button">Lirik: ON</button>
          <div class="ytm-fs-sync-pill" title="Atur sinkronisasi lirik di layar penuh">
            <button id="ytm-fs-minus" class="ytm-fs-mini-btn" type="button">-0.5s</button>
            <button id="ytm-fs-offset-val" class="ytm-fs-mini-val" type="button" title="Reset delay">0.0s</button>
            <button id="ytm-fs-plus" class="ytm-fs-mini-btn" type="button">+0.5s</button>
          </div>
        </div>
        <div id="ytm-fs-stage" class="ytm-fs-stage"></div>
        <div id="ytm-fs-bottom-hover-zone"></div>
      `;

      overlay.querySelector("#ytm-fs-toggle-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFullscreenLyrics();
      });
      overlay.querySelector("#ytm-fs-minus")?.addEventListener("click", (e) => {
        e.stopPropagation();
        adjustTrackOffset(-0.5);
      });
      overlay.querySelector("#ytm-fs-plus")?.addEventListener("click", (e) => {
        e.stopPropagation();
        adjustTrackOffset(0.5);
      });
      overlay.querySelector("#ytm-fs-offset-val")?.addEventListener("click", (e) => {
        e.stopPropagation();
        resetTrackOffset();
      });
    }

    const fsRoot =
      document.fullscreenElement || document.querySelector("ytmusic-player-page") || document.body;
    if (overlay.parentElement !== fsRoot) {
      fsRoot.appendChild(overlay);
    }

    updateFsToggleUI();
    return overlay;
  }

  function applyCenteredFiveLineWindow(targetIdx, forceScroll) {
    if (lyricItems.length === 0) return;

    const pane = document.getElementById("ytm-dual-lyrics");
    const centerIdx = targetIdx >= 0 ? targetIdx : 0;
    const halfSpan = Math.floor(MAX_VISIBLE_LINES / 2);
    const windowStart = Math.max(
      0,
      Math.min(centerIdx - halfSpan, Math.max(0, lyricItems.length - MAX_VISIBLE_LINES))
    );
    const windowEnd = windowStart + MAX_VISIBLE_LINES;

    const manualMode = Boolean(pane && Date.now() - userScrolledAt < 4000);
    if (pane && !manualMode) {
      pane.classList.remove("is-manual-browsing");
    }

    for (let i = 0; i < lyricItems.length; i++) {
      const el = lyricItems[i].el;
      if (!el) continue;

      const inWindow = i >= windowStart && i < windowEnd;
      const isActive = i === centerIdx;
      const relPos = i - centerIdx;

      el.classList.toggle("is-outside-window", !inWindow && !manualMode);
      el.classList.toggle("is-active", isActive);
      el.classList.toggle("is-before-active", inWindow && relPos < 0);
      el.classList.toggle("is-after-active", inWindow && relPos > 0);
    }

    const activeEl = lyricItems[centerIdx]?.el;
    if (pane && activeEl && (forceScroll || !manualMode)) {
      lastWindowStart = windowStart;
      const paneRect = pane.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      const currentDelta = elRect.top + elRect.height / 2 - (paneRect.top + paneRect.height / 2);
      const desiredScrollTop = pane.scrollTop + currentDelta;
      pane.scrollTo({
        top: Math.max(0, desiredScrollTop),
        behavior: "smooth"
      });
    } else {
      lastWindowStart = windowStart;
    }
  }

  function applyFullscreenWindow(targetIdx) {
    if (fsLyricItems.length === 0) return;

    const centerIdx = targetIdx >= 0 ? targetIdx : 0;
    const prevIdx = centerIdx - 1;

    for (let i = 0; i < fsLyricItems.length; i++) {
      const el = fsLyricItems[i].el;
      if (!el) continue;

      const isCurrent = i === centerIdx;
      const isPrev = i === prevIdx;
      const visible = isCurrent || isPrev;

      el.classList.toggle("is-fs-hidden", !visible);
      el.classList.toggle("is-fs-active", isCurrent);
      el.classList.toggle("is-fs-prev", isPrev);
      el.classList.remove("is-fs-next");
    }
  }

  function syncHighlight(forceScroll = false) {
    if (!isEnabled) return;
    updateOffsetUI();

    if (lyricItems.length === 0) return;
    const video = getVideoEl();
    if (!video) return;

    const effectiveTime = video.currentTime + trackOffsetSec;
    let nextIdx = -1;
    for (let i = 0; i < lyricItems.length; i++) {
      if (effectiveTime >= lyricItems[i].startTime) {
        nextIdx = i;
      } else {
        break;
      }
    }

    if (nextIdx !== activeIndex || forceScroll) {
      activeIndex = nextIdx;
      applyCenteredFiveLineWindow(nextIdx, forceScroll);
      applyFullscreenWindow(nextIdx);
    }
  }

  function renderLyricsView(forceRefresh = false) {
    if (!isEnabled) return;

    const host = ensureHostNode();
    const fsOverlay = ensureFullscreenOverlay();
    const fullscreenActive = isPlayerFullscreen();
    const tabSelected = isLyricsTabSelected();
    const shelf = tabSelected
      ? document.querySelector("ytmusic-player-page ytmusic-description-shelf-renderer")
      : null;

    syncFullscreenBodyState(fullscreenActive);
    fsOverlay.classList.toggle("is-visible", fullscreenActive && lyricItems.length > 0);

    if (!tabSelected || !shelf) {
      host.classList.remove("is-visible");
      const prevParent = host.parentElement;
      if (prevParent && prevParent !== document.body) {
        syncShelfChildrenVisibility(prevParent, false);
        document.body.appendChild(host);
      }
      lastTabSelected = false;
    } else {
      if (host.parentElement !== shelf) {
        shelf.appendChild(host);
      }
      host.classList.add("is-visible");
      syncShelfChildrenVisibility(shelf, true);
      setTimeout(() => {
        if (isLyricsTabSelected() && shelf.isConnected) {
          syncShelfChildrenVisibility(shelf, true);
        }
      }, 250);
    }

    if (!tabSelected && !fullscreenActive) {
      return;
    }

    const { title, artist, videoId } = getTrackInfo();
    const key = `${videoId || title}__${title}__${artist}`;

    if (key !== activeTrackKey) {
      activeTrackKey = key;
      renderedTrackKey = "";
      lyricItems = [];
      fsLyricItems = [];
      activeIndex = -1;
      lastWindowStart = -1;
      userScrolledAt = 0;
      trackOffsetSec = typeof savedOffsetsMap[key] === "number" ? savedOffsetsMap[key] : 0;
      updateOffsetUI();
    }

    const tabJustSwitched = tabSelected && !lastTabSelected;
    lastTabSelected = tabSelected;

    const video = getVideoEl();
    const duration = video ? video.duration : 0;
    const cached = syncedLyricsCache.get(key);

    if (!cached && fetchInFlightKey !== key) {
      fetchSyncedLyricsForTrack(key, title, artist, duration);
    }

    const lyricsPane = host.querySelector("#ytm-dual-lyrics");
    const fsStage = fsOverlay.querySelector("#ytm-fs-stage");
    if (!lyricsPane) return;

    if (!cached) {
      if (renderedTrackKey !== `${key}::LOADING`) {
        renderedTrackKey = `${key}::LOADING`;
        lyricsPane.innerHTML = `<div class="ytm-lyric-hint">Memuat lirik...</div>`;
        if (fsStage) fsStage.innerHTML = "";
      }
      return;
    }

    let baseTimed = [];
    let sourceName = "";

    if (cached.synced && cached.synced.length >= 2) {
      baseTimed = cached.synced;
      sourceName = cached.source || "LRCLIB (Synced)";
    } else if (Array.isArray(cached.plain) && cached.plain.length >= 2) {
      baseTimed = buildEstimatedTimings(cached.plain, duration);
      sourceName = cached.source || "YTM Fallback (Estimated)";
    } else {
      if (shelf) syncShelfChildrenVisibility(shelf, false);
      host.classList.remove("is-visible");
      fsOverlay.classList.remove("is-visible");
      if (renderedTrackKey !== `${key}::NONE`) {
        renderedTrackKey = `${key}::NONE`;
        lyricsPane.innerHTML = `<div class="ytm-lyric-hint">Lirik tidak tersedia untuk lagu ini.</div>`;
        if (fsStage) fsStage.innerHTML = "";
      }
      return;
    }

    const renderId = `${key}::${sourceName}`;
    if (!forceRefresh && !tabJustSwitched && renderedTrackKey === renderId && lyricItems.length > 0) {
      fsOverlay.classList.toggle("is-visible", fullscreenActive && lyricItems.length > 0);
      return;
    }

    renderedTrackKey = renderId;
    const timeline = buildCleanTimeline(baseTimed);

    const frag = document.createDocumentFragment();
    const hint = document.createElement("div");
    hint.className = "ytm-lyric-hint";
    frag.appendChild(hint);

    const fsFrag = document.createDocumentFragment();

    lyricItems = timeline.map((item, idx) => {
      const p = document.createElement("p");
      const classes = ["ytm-lyric-line", "align-center"];

      if (item.isInstrumental) {
        classes.push("ytm-lyric-instrumental");
      } else if (item.isSectionShift) {
        classes.push("is-section-shift");
      }

      p.className = classes.join(" ");
      p.textContent = item.isInstrumental ? "♫" : item.text;

      p.addEventListener("click", () => {
        const v = getVideoEl();
        if (v) {
          v.currentTime = Math.max(0, item.rawTime - trackOffsetSec + 0.05);
        }
        userScrolledAt = 0;
        activeIndex = idx;
        applyCenteredFiveLineWindow(idx, true);
        applyFullscreenWindow(idx);
      });

      frag.appendChild(p);
      return { ...item, el: p, index: idx };
    });

    fsLyricItems = timeline.map((item, idx) => {
      const fp = document.createElement("p");
      fp.className = "ytm-fs-line is-fs-hidden";
      if (item.isInstrumental) fp.classList.add("is-fs-instrumental");
      fp.textContent = item.isInstrumental ? "♫" : item.text;

      fp.addEventListener("click", (e) => {
        e.stopPropagation();
        const v = getVideoEl();
        if (v) {
          v.currentTime = Math.max(0, item.rawTime - trackOffsetSec + 0.05);
        }
        activeIndex = idx;
        applyCenteredFiveLineWindow(idx, true);
        applyFullscreenWindow(idx);
      });

      fsFrag.appendChild(fp);
      return { el: fp, index: idx };
    });

    lyricsPane.replaceChildren(frag);
    if (fsStage) {
      fsStage.replaceChildren(fsFrag);
    }

    fsOverlay.classList.toggle("is-visible", fullscreenActive && lyricItems.length > 0);
    activeIndex = -1;
    lastWindowStart = -1;
    syncHighlight(true);
  }

  function bindVideoListener() {
    const v = getVideoEl();
    if (v && v !== boundVideoEl) {
      boundVideoEl = v;
      v.addEventListener("timeupdate", () => syncHighlight(false));
      v.addEventListener("seeked", () => syncHighlight(true));
    }
  }

  document.addEventListener("fullscreenchange", () => {
    renderLyricsView(false);
    syncHighlight(true);
  });

  document.addEventListener(
    "click",
    () => {
      setTimeout(() => {
        bindVideoListener();
        renderLyricsView(false);
      }, 120);
    },
    true
  );

  renderLyricsView(true);
  pollTimer = setInterval(() => {
    bindVideoListener();
    renderLyricsView(false);
  }, 1500);
})();
```

### 5.4. `styles.css`
```css
ytmusic-description-shelf-renderer:has(#ytm-lyric-tab-host.is-visible) > *:not(#ytm-lyric-tab-host),
ytmusic-player-page ytmusic-section-list-renderer:has(#ytm-lyric-tab-host.is-visible) > *:not(ytmusic-description-shelf-renderer) {
  display: none !important;
}

#ytm-lyric-tab-host {
  position: relative;
  width: 100%;
  height: calc(100vh - 190px);
  min-height: 360px;
  max-height: 70vh;
  display: none;
  flex-direction: column;
  justify-content: space-between;
  background: transparent;
  color: #ffffff;
  font-family: "YouTube Sans", "Roboto", Arial, sans-serif;
  padding-top: 6px;
  overflow: hidden;
  box-sizing: border-box;
}

#ytm-lyric-tab-host.is-visible {
  display: flex;
}

.ytm-lyrics-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: clamp(95px, 19vh, 175px) clamp(12px, 2vw, 24px);
  overflow-y: auto;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.24) transparent;
}

.ytm-lyrics-pane::-webkit-scrollbar {
  width: 5px;
}

.ytm-lyrics-pane::-webkit-scrollbar-track {
  background: transparent;
}

.ytm-lyrics-pane::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.24);
  border-radius: 999px;
}

.ytm-lyric-hint {
  font-size: clamp(11px, 1vw, 13px);
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 16px;
  text-align: center;
  flex-shrink: 0;
}

.ytm-lyric-line {
  margin: 0;
  padding: 4px 0;
  max-height: 160px;
  font-size: clamp(20px, 2.4vw, 38px);
  font-weight: 700;
  line-height: 1.28;
  color: rgba(255, 255, 255, 0.42);
  cursor: pointer;
  text-align: center;
  overflow-wrap: break-word;
  transform-origin: center center;
  will-change: transform, color, opacity, max-height, margin;
  transition:
    color 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.38s cubic-bezier(0.22, 1, 0.36, 1),
    max-height 0.36s cubic-bezier(0.22, 1, 0.36, 1),
    margin 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    padding 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.ytm-lyric-line.is-outside-window {
  max-height: 0;
  padding: 0;
  margin: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.ytm-lyrics-pane.is-manual-browsing .ytm-lyric-line.is-outside-window {
  max-height: 160px;
  padding: 4px 0;
  margin: 4px 0;
  opacity: 0.35;
  overflow: visible;
  pointer-events: auto;
}

.ytm-lyric-line.is-before-active {
  margin: -10px 0 2px;
  font-size: clamp(20px, 2.15vw, 34px);
  opacity: 0.5;
  transform: translateY(4px) scale(0.96);
}

.ytm-lyric-line.is-after-active {
  margin: 2px 0 -10px;
  font-size: clamp(20px, 2.15vw, 34px);
  opacity: 0.5;
  transform: translateY(-4px) scale(0.96);
}

.ytm-lyric-line:hover {
  color: rgba(255, 255, 255, 0.88);
  opacity: 0.92;
}

.ytm-lyric-line.is-active {
  margin: 12px 0;
  color: #ffffff;
  opacity: 1;
  font-size: clamp(26px, 2.95vw, 46px);
  transform: translateY(0) scale(1.03);
}

.ytm-lyric-instrumental {
  letter-spacing: 4px;
}

.ytm-bottom-dock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 8px;
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.ytm-sync-readout {
  font-size: clamp(11px, 1vw, 13px);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.72);
  letter-spacing: 0.2px;
}

.ytm-sync-bar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.ytm-sync-btn,
.ytm-sync-val {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font-size: clamp(12px, 1.1vw, 14px);
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.16s ease;
}

.ytm-sync-val {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.16);
  min-width: 58px;
}

.ytm-sync-btn:hover,
.ytm-sync-val:hover {
  background: rgba(255, 255, 255, 0.24);
  color: #ffffff;
}

.ytm-sync-btn:active,
.ytm-sync-val:active {
  transform: scale(0.96);
}

/* ================= FULLSCREEN LYRICS & HOVER NAV ================= */

body.ytm-fs-active-mode ytmusic-player-bar,
body.ytm-fs-active-mode #player-bar-background {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s ease, transform 0.28s ease;
}

body.ytm-fs-active-mode:has(ytmusic-player-bar:hover) ytmusic-player-bar,
body.ytm-fs-active-mode:has(ytmusic-player-bar:hover) #player-bar-background,
body.ytm-fs-active-mode:has(#ytm-fs-bottom-hover-zone:hover) ytmusic-player-bar,
body.ytm-fs-active-mode:has(#ytm-fs-bottom-hover-zone:hover) #player-bar-background {
  opacity: 1;
  pointer-events: auto;
}

#ytm-fs-lyrics-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: none;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
  font-family: "YouTube Sans", "Roboto", Arial, sans-serif;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.62) 0%,
    rgba(0, 0, 0, 0.14) 28%,
    rgba(0, 0, 0, 0) 55%
  );
}

#ytm-fs-lyrics-overlay.is-visible {
  display: flex;
}

.ytm-fs-hud {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 22px 28px;
  pointer-events: none;
}

.ytm-fs-pill-btn,
.ytm-fs-sync-pill {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(15, 15, 18, 0.58);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  opacity: 0.65;
  transition: opacity 0.25s ease, background-color 0.2s ease, transform 0.16s ease;
}

.ytm-fs-pill-btn:hover,
.ytm-fs-sync-pill:hover {
  opacity: 1;
  background: rgba(15, 15, 18, 0.82);
}

.ytm-fs-pill-btn.is-off {
  color: rgba(255, 255, 255, 0.55);
}

.ytm-fs-mini-btn,
.ytm-fs-mini-val {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
}

.ytm-fs-mini-val {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.16);
  min-width: 46px;
}

.ytm-fs-mini-btn:hover,
.ytm-fs-mini-val:hover {
  background: rgba(255, 255, 255, 0.28);
}

.ytm-fs-stage {
  margin-bottom: clamp(76px, 11vh, 112px);
  padding: 0 clamp(20px, 8vw, 140px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.ytm-fs-stage.is-collapsed {
  opacity: 0;
  pointer-events: none;
  transform: translateY(10px);
}

.ytm-fs-line {
  margin: 0;
  padding: 4px 16px;
  max-height: 150px;
  font-size: clamp(20px, 2.3vw, 34px);
  font-weight: 700;
  line-height: 1.28;
  color: rgba(255, 255, 255, 0.52);
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.88);
  cursor: pointer;
  pointer-events: auto;
  transform-origin: center center;
  transition:
    color 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.38s cubic-bezier(0.22, 1, 0.36, 1),
    max-height 0.36s cubic-bezier(0.22, 1, 0.36, 1),
    margin 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.ytm-fs-line.is-fs-hidden,
.ytm-fs-line.is-fs-next {
  max-height: 0;
  padding: 0;
  margin: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.ytm-fs-line.is-fs-prev {
  margin-bottom: -4px;
  opacity: 0.45;
  transform: translateY(2px) scale(0.95);
}

.ytm-fs-line:hover {
  color: rgba(255, 255, 255, 0.9);
  opacity: 0.95;
}

.ytm-fs-line.is-fs-active {
  margin: 8px 0;
  font-size: clamp(28px, 3.4vw, 52px);
  color: #ffffff;
  opacity: 1;
  transform: translateY(0) scale(1.03);
  text-shadow:
    0 3px 18px rgba(0, 0, 0, 0.95),
    0 0 28px rgba(0, 0, 0, 0.65);
}

.ytm-fs-instrumental {
  letter-spacing: 5px;
}

#ytm-fs-bottom-hover-zone {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 92px;
  z-index: 2147482999;
  pointer-events: auto;
  background: transparent;
}
```

---

## 6. Panduan Pengembangan Lanjutan (Next Steps)
* **Timing Fallback Berbasis Jeda Instrumental:** Saat masuk ke `YTM Fallback (Estimated)`, saat ini distribusi waktu memakai proporsi panjang karakter per baris. Bisa ditingkatkan dengan mendeteksi baris kosong (`\n\n`) antar bait (*verse/chorus*) untuk memberi jeda ekstra otomatis.
* **Duet / Multi-Vocal Alignment:** Nama proyek mencantumkan *duet styling*; dukungan parser tag `v1:` / `v2:` atau `[F]` / `[M]` dapat ditambahkan di `parseLRC()` dengan class `.align-left` / `.align-right` apabila dibutuhkan kembali.