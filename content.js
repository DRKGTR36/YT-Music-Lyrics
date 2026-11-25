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

  const LRC_TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  function detectSpeaker(text) {
    const prefix = text.match(/^\s*v([12])\s*:\s*/i);
    if (prefix) {
      return { speaker: Number(prefix[1]), text: text.slice(prefix[0].length) };
    }
    const tag = text.match(/^\s*\[(male|female|man|woman|m|f)\]\s*/i);
    if (tag) {
      const speaker = /^(male|man|m)$/i.test(tag[1]) ? 1 : 2;
      return { speaker, text: text.slice(tag[0].length) };
    }
    return { speaker: 0, text };
  }

  function parseLRC(lrcText) {
    if (!lrcText || typeof lrcText !== "string") return [];
    const lines = [];

    for (const rawLine of lrcText.split(/\r?\n/)) {
      LRC_TIME_TAG.lastIndex = 0;
      const stamps = [];
      let match;
      let lastEnd = 0;
      while ((match = LRC_TIME_TAG.exec(rawLine)) !== null) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const frac = match[3] || "0";
        const ms = parseInt(frac.padEnd(3, "0").slice(0, 3), 10);
        stamps.push(min * 60 + sec + ms / 1000);
        lastEnd = LRC_TIME_TAG.lastIndex;
      }
      if (!stamps.length) continue;

      const text = rawLine.slice(lastEnd).trim();
      if (!text) continue;

      const speakerInfo = detectSpeaker(text);
      for (const time of stamps) {
        lines.push({ time, text: speakerInfo.text, speaker: speakerInfo.speaker });
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

  function splitPlainLyrics(text) {
    const out = [];
    let blankPending = false;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        if (!blankPending) {
          out.push("");
          blankPending = true;
        }
        continue;
      }
      out.push(line);
      blankPending = false;
    }
    return out;
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
        if (!raw) continue;
        const lines = splitPlainLyrics(raw);
        const contentCount = lines.filter(Boolean).length;
        if (contentCount >= 2) {
          return lines;
        }
      }
    }
    return [];
  }

  async function fetchSyncedLyricsForTrack(key, title, artist, durationSec, shelf) {
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
          resolve({ ok: false, provider: "None", candidates: [] });
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
              resolve({ ok: false, provider: "None", candidates: [] });
              return;
            }
            resolve(res || { ok: false, provider: "None", candidates: [] });
          }
        );
      });

      if (!response.ok) {
        const empty = { synced: null, plain: [], source: "None", credits: "", at: Date.now(), retryable: true };
        syncedLyricsCache.set(key, empty);
        return empty;
      }

      const providerLabel = response.provider || "LRCLIB";
      const candidates = Array.isArray(response.candidates) ? response.candidates : [];
      const bestSynced = pickBestSyncedCandidate(candidates, durationSec);
      const plainSource = bestSynced || candidates.find((c) => c.plainLyrics);
      const chosenMeta = bestSynced || plainSource || null;

      let plainLines = splitPlainLyrics(plainSource?.plainLyrics || "");
      let source = bestSynced
        ? `${providerLabel} (Synced)`
        : plainLines.filter(Boolean).length >= 2
          ? `${providerLabel} (Plain)`
          : "None";

      if (!bestSynced && plainLines.filter(Boolean).length < 2) {
        const domLines = extractNativeDomLyrics(shelf);
        if (domLines.filter(Boolean).length >= 2) {
          plainLines = domLines;
          source = "YTM Fallback (Estimated)";
        }
      }

      const result = {
        synced: bestSynced ? bestSynced.parsed : null,
        plain: plainLines,
        source,
        credits: extractCreditsFromCandidate(chosenMeta),
        at: Date.now(),
        retryable: source === "None"
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
      const domLines = extractNativeDomLyrics(shelf);
      const fallbackResult = {
        synced: null,
        plain: domLines,
        source: domLines.filter(Boolean).length >= 2 ? "YTM Fallback (Estimated)" : "None",
        credits: "",
        at: Date.now(),
        retryable: true
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
    const content = lines.filter(Boolean);
    if (!content.length) return [];

    const totalDuration =
      durationSec && isFinite(durationSec) && durationSec > 10 ? durationSec : content.length * 4;
    const startBuffer = Math.min(3, totalDuration * 0.02);
    const verseGapSec = 2.2;
    const gapCount = lines.filter((l) => !l).length;
    const usableDuration = Math.max(10, totalDuration - startBuffer - 2 - gapCount * verseGapSec);

    const weights = content.map((line) => Math.max(line.length, 8));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    let cursor = startBuffer;
    const timed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        cursor += verseGapSec;
        continue;
      }
      const weight = weights[timed.length];
      timed.push({ time: cursor, text: line, speaker: 0 });
      cursor += (weight / totalWeight) * usableDuration;
    }

    return timed;
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
        speaker: curr.speaker || 0,
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
      fetchSyncedLyricsForTrack(key, title, artist, duration, shelf);
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
    } else if (Array.isArray(cached.plain) && cached.plain.filter(Boolean).length >= 2) {
      baseTimed = buildEstimatedTimings(cached.plain, duration);
      sourceName = cached.source || "LRCLIB (Plain)";
    } else {
      // Lirik native YouTube Music bisa muncul belakangan; ambil langsung dari DOM tiap render.
      const domLines = extractNativeDomLyrics(shelf);
      if (domLines.filter(Boolean).length >= 2) {
        baseTimed = buildEstimatedTimings(domLines, duration);
        sourceName = "YTM Fallback (Estimated)";
      }
    }

    if (!baseTimed.length) {
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
    hint.textContent = cached.credits
      ? `${sourceName} • ${cached.credits}`
      : sourceName;
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

      if (item.speaker === 1) {
        classes.push("ytm-speaker-left");
      } else if (item.speaker === 2) {
        classes.push("ytm-speaker-right");
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
      if (item.isInstrumental) fp.classList.add("ytm-fs-instrumental");
      if (item.speaker === 1) fp.classList.add("is-fs-speaker-left");
      if (item.speaker === 2) fp.classList.add("is-fs-speaker-right");
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