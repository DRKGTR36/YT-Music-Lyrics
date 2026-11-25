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