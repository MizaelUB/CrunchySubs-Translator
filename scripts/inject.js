(function() {
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
    const res = await origFetch.apply(this, args);
    try {
        const clone = res.clone();
        clone.text().then(text => {
            if (text.includes('.ass') || text.includes('.vtt') || text.includes('subtitles')) {
                console.log("🔥 [CRUNCHY-EXT] Found subtitles in FETCH:", url);
                try {
                    window.postMessage({ type: 'CR_STREAMS_DATA', data: JSON.parse(text) }, '*');
                } catch(err) {
                    console.log("[CRUNCHY-EXT] Failed to parse JSON from FETCH", err);
                }
            }
        }).catch(e => {});
    } catch(e) {}
    return res;
  };
  
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.addEventListener('load', function() {
      try {
        if (this.responseType !== '' && this.responseType !== 'text') return;
        const text = this.responseText;
        if (typeof text === 'string' && (text.includes('.ass') || text.includes('.vtt') || text.includes('subtitles'))) {
            console.log("🔥 [CRUNCHY-EXT] Found subtitles in XHR:", url);
            try {
                window.postMessage({ type: 'CR_STREAMS_DATA', data: JSON.parse(text) }, '*');
            } catch(err) {
                console.log("[CRUNCHY-EXT] Failed to parse JSON from XHR", err);
            }
        }
      } catch(e) {}
    });
    origOpen.apply(this, arguments);
  };
})();
