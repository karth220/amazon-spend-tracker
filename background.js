// Service worker for Amazon.in Spend Analyzer
chrome.runtime.onInstalled.addListener(() => {
  console.log("Amazon.in Spend Analyzer extension installed.");
});

// Service worker to handle background tasks and credentials
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'active' });
    return true;
  }
  
  if (request.action === 'fetch_url') {
    // credentials: 'include' ensures browser cookies are attached to the fetch request
    fetch(request.url, { credentials: 'include' })
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP Status ${res.status}`);
        }
        return res.text();
      })
      .then(text => {
        sendResponse({ success: true, text: text });
      })
      .catch(err => {
        console.error("Background fetch failed for url:", request.url, err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
  
  return true;
});
