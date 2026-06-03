document.addEventListener('DOMContentLoaded', () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const statusDesc = document.getElementById('statusDesc');
  const actionBtn = document.getElementById('actionBtn');

  let amazonTab = null;

  // Query Chrome tabs to see if there is an active amazon.in tab
  chrome.tabs.query({ url: '*://*.amazon.in/*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      amazonTab = tabs[0];
      // Set status to Ready
      statusIndicator.className = 'status-indicator status-ready';
      statusText.textContent = 'Amazon.in Detected';
      statusDesc.textContent = 'You have an active Amazon.in tab open. Open the dashboard to start scanning your spend history.';
      actionBtn.textContent = 'Open Spend Dashboard';
      actionBtn.onclick = () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      };
    } else {
      // Set status to Waiting / Not Found
      statusIndicator.className = 'status-indicator status-waiting';
      statusText.textContent = 'No Amazon Tab Found';
      statusDesc.textContent = 'Please open Amazon India and log in. Once ready, click below to open your Amazon.in orders page.';
      actionBtn.textContent = 'Open Amazon.in Orders';
      actionBtn.onclick = () => {
        chrome.tabs.create({ url: 'https://www.amazon.in/your-orders/orders' }, () => {
          window.close(); // Close popup
        });
      };
    }
  });
});
