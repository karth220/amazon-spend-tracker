// Service worker for Amazon.in Spend Analyzer
chrome.runtime.onInstalled.addListener(() => {
  console.log("Amazon.in Spend Analyzer extension installed.");
});

// Listener to handle requests if dashboard needs background worker delegation
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'active' });
  }
  return true;
});
