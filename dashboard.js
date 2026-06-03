// dashboard.js - Amazon.in Spend Analyzer Dashboard Controller

// Global State
let scrapedOrders = [];
let availableYears = [];
let scanState = {
  isScanning: false,
  isPaused: false,
  yearsToScan: [],
  currentYearIndex: 0,
  currentStartIndex: 0,
  amazonTabId: null,
  totalScannedThisRun: 0
};

// Pagination State
let filteredOrders = [];
let currentPage = 1;
const pageSize = 10;

// DOM Elements
const scanBtn = document.getElementById('scanBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const yearSelector = document.getElementById('yearSelector');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const alertBanner = document.getElementById('alertBanner');
const alertTitle = document.getElementById('alertTitle');
const alertMessage = document.getElementById('alertMessage');
const alertActionBtn = document.getElementById('alertActionBtn');
const emptyState = document.getElementById('emptyState');
const dashboardContent = document.getElementById('dashboardContent');

// Metrics DOM Elements
const metricTotalSpent = document.getElementById('metricTotalSpent');
const metricTotalOrders = document.getElementById('metricTotalOrders');
const metricDeliveredRatio = document.getElementById('metricDeliveredRatio');
const metricAvgOrderValue = document.getElementById('metricAvgOrderValue');
const metricItemsBought = document.getElementById('metricItemsBought');
const metricAvgItems = document.getElementById('metricAvgItems');
const metricActivePeriod = document.getElementById('metricActivePeriod');

// Filters DOM Elements
const searchInput = document.getElementById('searchInput');
const filterYear = document.getElementById('filterYear');
const filterStatus = document.getElementById('filterStatus');
const sortOrder = document.getElementById('sortOrder');
const ordersTableBody = document.getElementById('ordersTableBody');
const transactionCount = document.getElementById('transactionCount');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');

// Export DOM Elements
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEventListeners();
  detectAmazonTab();
});

// Load saved data from storage
function loadData() {
  chrome.storage.local.get(['amazonOrders', 'amazonYears'], (result) => {
    if (result.amazonOrders && result.amazonOrders.length > 0) {
      scrapedOrders = result.amazonOrders;
      availableYears = result.amazonYears || extractUniqueYears(scrapedOrders);
      
      // Update Dropdowns
      populateYearSelectors();
      
      // Toggle views
      emptyState.classList.add('hidden');
      dashboardContent.classList.remove('hidden');
      
      // Render dashboard contents
      updateDashboardUI();
    } else {
      emptyState.classList.remove('hidden');
      dashboardContent.classList.add('hidden');
      // Generate default years in selector to let them scan
      const currentYear = new Date().getFullYear();
      availableYears = [];
      for (let y = currentYear; y >= 2013; y--) {
        availableYears.push(y);
      }
      populateYearSelectors();
    }
  });
}

// Save data to storage
function saveData() {
  chrome.storage.local.set({
    amazonOrders: scrapedOrders,
    amazonYears: availableYears
  });
}

// Setup Event Listeners
function setupEventListeners() {
  scanBtn.addEventListener('click', startScanHandler);
  pauseBtn.addEventListener('click', togglePauseHandler);
  resetBtn.addEventListener('click', clearDataHandler);
  
  // Filtering & Sorting Listeners
  searchInput.addEventListener('input', applyFiltersAndRender);
  filterYear.addEventListener('change', applyFiltersAndRender);
  filterStatus.addEventListener('change', applyFiltersAndRender);
  sortOrder.addEventListener('change', applyFiltersAndRender);
  
  // Pagination
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });
  
  nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredOrders.length / pageSize);
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });

  // Export Listeners
  exportCsvBtn.addEventListener('click', () => exportData('csv'));
  exportJsonBtn.addEventListener('click', () => exportData('json'));
  document.getElementById('exportCsvBtn').addEventListener('click', () => exportData('csv'));
  document.getElementById('exportJsonBtn').addEventListener('click', () => exportData('json'));

  // Redraw charts on window resize for responsiveness
  window.addEventListener('resize', debounce(() => {
    if (scrapedOrders.length > 0) {
      renderCharts();
    }
  }, 250));
}

// Debounce helper for window resize
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Detect if an Amazon tab is open
function detectAmazonTab(callback) {
  chrome.tabs.query({ url: '*://*.amazon.in/*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      scanState.amazonTabId = tabs[0].id;
      if (callback) callback(true);
    } else {
      scanState.amazonTabId = null;
      if (callback) callback(false);
    }
  });
}

// Ensure content script is injected into the Amazon tab
function ensureContentScriptInjected(tabId, callback) {
  // Test if content script is active by sending a ping
  chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      console.log("Content script not detected. Injecting content.js dynamically...");
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }).then(() => {
        console.log("Successfully injected content.js dynamically.");
        // Give it a tiny delay to initialize
        setTimeout(() => callback(true), 250);
      }).catch(err => {
        console.error("Failed to inject content.js dynamically:", err);
        callback(false);
      });
    } else {
      console.log("Content script is already active and responding.");
      callback(true);
    }
  });
}

// Populate Year Filter Selectors
function populateYearSelectors() {
  // Clear previous options except "All"
  yearSelector.innerHTML = '<option value="all">All Years (Automatic)</option>';
  filterYear.innerHTML = '<option value="all">All Years</option>';
  
  availableYears.forEach(year => {
    const opt1 = document.createElement('option');
    opt1.value = year;
    opt1.textContent = year;
    yearSelector.appendChild(opt1);
    
    const opt2 = document.createElement('option');
    opt2.value = year;
    opt2.textContent = year;
    filterYear.appendChild(opt2);
  });
}

// Scan Period click handler
function startScanHandler() {
  if (scanState.isScanning) return;

  detectAmazonTab((tabFound) => {
    if (!tabFound) {
      // Prompt user to open Amazon.in
      showAlert(
        "Amazon India Tab Not Found",
        "We could not detect an active Amazon.in tab. We are opening the orders page in a new tab. Please log in there, then return here and click 'Start Scan' again.",
        "https://www.amazon.in/your-orders/orders"
      );
      return;
    }
    
    hideAlert();
    
    // Ensure content script is injected before starting the scan
    ensureContentScriptInjected(scanState.amazonTabId, (injected) => {
      if (!injected) {
        pauseScanDueToError("Failed to initialize connection script. Please refresh your Amazon tab and try again.");
        return;
      }
      
      // Set up scanning parameters
      const selectedVal = yearSelector.value;
      if (selectedVal === 'all') {
        // Start with current year, and content script will feed us other years from the dropdown
        const currentYear = new Date().getFullYear();
        scanState.yearsToScan = [currentYear];
      } else {
        scanState.yearsToScan = [parseInt(selectedVal)];
      }

      scanState.isScanning = true;
      scanState.isPaused = false;
      scanState.currentYearIndex = 0;
      scanState.currentStartIndex = 0;
      scanState.totalScannedThisRun = 0;

      // Toggle Buttons
      scanBtn.disabled = true;
      pauseBtn.disabled = false;
      pauseBtn.textContent = "Pause";
      yearSelector.disabled = true;
      
      progressSection.classList.remove('hidden');
      emptyState.classList.add('hidden');
      dashboardContent.classList.remove('hidden');

      runScanCycle();
    });
  });
}

// Main recursive scanning loop
async function runScanCycle() {
  if (!scanState.isScanning || scanState.isPaused) return;

  const currentYear = scanState.yearsToScan[scanState.currentYearIndex];
  if (!currentYear) {
    // Finished scanning all years in the list
    completeScan();
    return;
  }

  updateProgress(
    `Scanning Year ${currentYear}... Page ${Math.floor(scanState.currentStartIndex / 10) + 1}`,
    calculateOverallPercent()
  );

  // Send message to content script to fetch and scrape the page
  chrome.tabs.sendMessage(
    scanState.amazonTabId,
    {
      action: 'scrape_page',
      year: currentYear,
      startIndex: scanState.currentStartIndex
    },
    async (response) => {
      // Check for communication errors
      if (chrome.runtime.lastError) {
        console.error("Connection Error:", chrome.runtime.lastError.message);
        // Attempt to inject the content script dynamically and retry
        detectAmazonTab((tabFound) => {
          if (!tabFound) {
            pauseScanDueToError("Amazon tab was closed. Please open Amazon.in and resume.");
          } else {
            console.log("Tab is active, attempting to re-inject and retry...");
            ensureContentScriptInjected(scanState.amazonTabId, (success) => {
              if (success) {
                // Retry scanning the page
                setTimeout(runScanCycle, 1000);
              } else {
                pauseScanDueToError("Could not establish connection with the Amazon tab. Please reload your Amazon tab and try again.");
              }
            });
          }
        });
        return;
      }

      if (!response) {
        pauseScanDueToError("Received empty response from the browser page. Retrying...");
        return;
      }

      if (!response.success) {
        if (response.isCaptcha) {
          // CAPTCHA Block
          showAlert(
            "Security Check Encountered",
            "Amazon.in is displaying a verification screen. Please click below to open your Amazon tab, solve the CAPTCHA puzzle, and then click Resume Scanning here.",
            "https://www.amazon.in/your-orders/orders"
          );
          togglePauseHandler(true); // Force pause
        } else {
          // Standard error
          pauseScanDueToError(response.error || "An error occurred during page scraping.");
        }
        return;
      }

      // Scraping was successful! Process orders
      const newOrders = response.orders || [];
      
      // Feed years dropdown list into our state if we are doing automatic scan
      if (response.years && yearSelector.value === 'all') {
        const uniqueYears = [...new Set([...availableYears, ...response.years])].sort((a, b) => b - a);
        if (uniqueYears.length > availableYears.length) {
          availableYears = uniqueYears;
          populateYearSelectors();
          // Update the scan list dynamically if it contains years we haven't planned to scan yet
          response.years.forEach(y => {
            if (!scanState.yearsToScan.includes(y)) {
              scanState.yearsToScan.push(y);
            }
          });
          scanState.yearsToScan.sort((a, b) => b - a); // Keep scanning chronologically
        }
      }

      // Merge new orders with existing dataset, avoiding duplicates by order ID
      let addedCount = 0;
      newOrders.forEach(order => {
        const exists = scrapedOrders.some(o => o.orderId === order.orderId);
        if (!exists) {
          scrapedOrders.push(order);
          addedCount++;
        } else {
          // Update existing order details (status, etc.) in case they changed
          const idx = scrapedOrders.findIndex(o => o.orderId === order.orderId);
          if (idx !== -1) {
            scrapedOrders[idx] = order;
          }
        }
      });

      scanState.totalScannedThisRun += addedCount;

      // Update UI & save data in real-time
      saveData();
      updateDashboardUI();

      // Determine next steps
      if (response.hasNextPage && newOrders.length > 0) {
        // Fetch next page of the current year
        scanState.currentStartIndex += 10;
        // Wait a random delay (700ms - 1500ms) to avoid anti-scraping blocks
        const delay = Math.random() * 800 + 700;
        setTimeout(runScanCycle, delay);
      } else {
        // Finished current year, move to next year in queue
        scanState.currentYearIndex++;
        scanState.currentStartIndex = 0;
        setTimeout(runScanCycle, 1000);
      }
    }
  );
}

// Pause/Resume Scans
function togglePauseHandler(forcePause = false) {
  if (!scanState.isScanning) return;

  if (scanState.isPaused && forcePause !== true) {
    // Resume
    scanState.isPaused = false;
    pauseBtn.textContent = "Pause";
    hideAlert();
    runScanCycle();
  } else {
    // Pause
    scanState.isPaused = true;
    pauseBtn.textContent = "Resume";
    updateProgress("Scan paused.", calculateOverallPercent());
  }
}

// Handle scan completion
function completeScan() {
  scanState.isScanning = false;
  scanState.isPaused = false;

  scanBtn.disabled = false;
  pauseBtn.disabled = true;
  pauseBtn.textContent = "Pause";
  yearSelector.disabled = false;

  updateProgress("Scan completed successfully!", 100);
  setTimeout(() => {
    progressSection.classList.add('hidden');
  }, 4000);
}

// Handle scan errors
function pauseScanDueToError(errorMsg) {
  scanState.isPaused = true;
  pauseBtn.textContent = "Resume";
  updateProgress(`Error: ${errorMsg}. Scan paused.`, calculateOverallPercent());
  showAlert(
    "Scan Interrupted",
    `The scanning process encountered an error: ${errorMsg}. Please ensure you are logged in, then click Resume.`,
    "https://www.amazon.in/your-orders/orders"
  );
}

// Helper to calculate progress percentages
function calculateOverallPercent() {
  if (scanState.yearsToScan.length === 0) return 0;
  const yearWeight = 100 / scanState.yearsToScan.length;
  
  // Current year progress is estimated. Let's assume average of 3 pages (30 orders) per year
  // If index is higher, it adds up
  const currentPageIndex = Math.min(2, Math.floor(scanState.currentStartIndex / 10));
  const currentYearProgress = (currentPageIndex / 3) * yearWeight;
  
  const completedYearsProgress = scanState.currentYearIndex * yearWeight;
  const totalPercent = Math.min(99, Math.round(completedYearsProgress + currentYearProgress));
  return isNaN(totalPercent) ? 0 : totalPercent;
}

function updateProgress(status, percent) {
  progressStatus.textContent = status;
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
}

// Alert Banner helpers
function showAlert(title, msg, linkUrl = null) {
  alertBanner.classList.remove('hidden');
  alertTitle.textContent = title;
  alertMessage.textContent = msg;
  
  if (linkUrl) {
    alertActionBtn.classList.remove('hidden');
    alertActionBtn.onclick = () => {
      chrome.tabs.create({ url: linkUrl });
    };
  } else {
    alertActionBtn.classList.add('hidden');
  }
}

function hideAlert() {
  alertBanner.classList.add('hidden');
}

// Clear all scraped data
function clearDataHandler() {
  if (confirm("Are you sure you want to clear all your scanned amazon.in spend data? This cannot be undone.")) {
    scrapedOrders = [];
    saveData();
    
    // Return to empty state
    emptyState.classList.remove('hidden');
    dashboardContent.classList.add('hidden');
    progressSection.classList.add('hidden');
    hideAlert();
    
    // Reset scan state
    scanState.isScanning = false;
    scanState.isPaused = false;
    scanBtn.disabled = false;
    pauseBtn.disabled = true;
    yearSelector.disabled = false;
  }
}

// Update the full Dashboard stats, charts, and tables
function updateDashboardUI() {
  updateMetrics();
  renderCharts();
  applyFiltersAndRender();
}

// 1. Calculate and update metrics widgets
function updateMetrics() {
  // If status is Cancelled, we exclude the order amount from spends!
  const validOrders = scrapedOrders.filter(o => o.status !== 'Cancelled');
  const deliveredOrders = scrapedOrders.filter(o => o.status === 'Delivered');

  let totalSpent = 0;
  let totalItems = 0;
  
  validOrders.forEach(order => {
    totalSpent += cleanPrice(order.totalStr);
    totalItems += order.items ? order.items.length : 0;
  });

  const avgOrderValue = validOrders.length > 0 ? (totalSpent / validOrders.length) : 0;
  const avgItemsPerOrder = validOrders.length > 0 ? (totalItems / validOrders.length) : 0;

  metricTotalSpent.textContent = formatCurrency(totalSpent);
  metricTotalOrders.textContent = scrapedOrders.length;
  metricDeliveredRatio.textContent = `${deliveredOrders.length} delivered, ${scrapedOrders.length - deliveredOrders.length} others`;
  metricAvgOrderValue.textContent = formatCurrency(avgOrderValue);
  metricItemsBought.textContent = totalItems;
  metricAvgItems.textContent = `${avgItemsPerOrder.toFixed(1)} items per order`;

  // Set the subtitle period
  const selectedPeriod = yearSelector.value;
  metricActivePeriod.textContent = selectedPeriod === 'all' ? 'Across all years' : `In ${selectedPeriod}`;
}

// 2. Render dynamically generated SVG charts
function renderCharts() {
  renderYearlyChart();
  renderMonthlyChart();
}

function renderYearlyChart() {
  const container = document.getElementById('yearlyChartContainer');
  container.innerHTML = '';

  const validOrders = scrapedOrders.filter(o => o.status !== 'Cancelled');
  if (validOrders.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">No spends data available</div>';
    return;
  }

  // Aggregate spends by year
  const yearlySpends = {};
  validOrders.forEach(o => {
    const d = parseDate(o.date);
    const y = d ? d.getFullYear() : (parseInt(o.date.match(/\d{4}/)) || new Date().getFullYear());
    yearlySpends[y] = (yearlySpends[y] || 0) + cleanPrice(o.totalStr);
  });

  const years = Object.keys(yearlySpends).sort((a, b) => a - b);
  if (years.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">No spends data available</div>';
    return;
  }

  const values = years.map(y => yearlySpends[y]);
  const maxValue = Math.max(...values, 100);

  // SVG Chart Geometry
  const width = container.clientWidth || 500;
  const height = 240;
  const padLeft = 55;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  let svg = `<svg class="chart-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f97316" />
        <stop offset="100%" stop-color="#ea580c" />
      </linearGradient>
      <linearGradient id="barHoverGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fb923c" />
        <stop offset="100%" stop-color="#f97316" />
      </linearGradient>
    </defs>
  `;

  // Draw 4 horizontal grid lines and labels
  for (let i = 0; i <= 4; i++) {
    const y = padTop + (plotH / 4) * i;
    const gridValue = maxValue - (maxValue / 4) * i;
    svg += `
      <line class="chart-grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" />
      <text class="chart-label" x="${padLeft - 10}" y="${y + 4}" text-anchor="end">₹${formatCompactPrice(gridValue)}</text>
    `;
  }

  // Draw bars
  const gap = 20;
  const barW = Math.max(16, (plotW - gap * (years.length - 1)) / years.length);

  years.forEach((yr, idx) => {
    const val = yearlySpends[yr];
    const barH = (val / maxValue) * plotH;
    const x = padLeft + idx * (barW + gap);
    const y = padTop + plotH - barH;

    svg += `
      <rect class="chart-bar" x="${x}" y="${y}" width="${barW}" height="${Math.max(2, barH)}" rx="4" />
      <text class="chart-label" x="${x + barW/2}" y="${height - 10}">${yr}</text>
      <text class="chart-val-label" x="${x + barW/2}" y="${y - 8}">₹${formatCompactPrice(val)}</text>
    `;
  });

  // Base line
  svg += `<line class="chart-axis-line" x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" />`;
  svg += `</svg>`;
  container.innerHTML = svg;
}

function renderMonthlyChart() {
  const container = document.getElementById('monthlyChartContainer');
  container.innerHTML = '';

  const validOrders = scrapedOrders.filter(o => o.status !== 'Cancelled');
  if (validOrders.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">No spends data available</div>';
    return;
  }

  // Aggregate spends by month
  const monthlySpends = Array(12).fill(0);
  validOrders.forEach(o => {
    const d = parseDate(o.date);
    if (d) {
      const m = d.getMonth(); // 0 to 11
      monthlySpends[m] += cleanPrice(o.totalStr);
    }
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const maxValue = Math.max(...monthlySpends, 100);

  // SVG Chart Geometry
  const width = container.clientWidth || 500;
  const height = 240;
  const padLeft = 55;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  let svg = `<svg class="chart-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f97316" />
        <stop offset="100%" stop-color="#ea580c" />
      </linearGradient>
      <linearGradient id="barHoverGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fb923c" />
        <stop offset="100%" stop-color="#f97316" />
      </linearGradient>
    </defs>
  `;

  // Draw 4 horizontal grid lines and labels
  for (let i = 0; i <= 4; i++) {
    const y = padTop + (plotH / 4) * i;
    const gridValue = maxValue - (maxValue / 4) * i;
    svg += `
      <line class="chart-grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" />
      <text class="chart-label" x="${padLeft - 10}" y="${y + 4}" text-anchor="end">₹${formatCompactPrice(gridValue)}</text>
    `;
  }

  // Draw bars
  const gap = 8;
  const barW = (plotW - gap * 11) / 12;

  monthNames.forEach((month, idx) => {
    const val = monthlySpends[idx];
    const barH = (val / maxValue) * plotH;
    const x = padLeft + idx * (barW + gap);
    const y = padTop + plotH - barH;

    svg += `
      <rect class="chart-bar" x="${x}" y="${y}" width="${barW}" height="${Math.max(2, barH)}" rx="3" />
      <text class="chart-label" x="${x + barW/2}" y="${height - 10}">${month}</text>
      ${val > 0 ? `<text class="chart-val-label" x="${x + barW/2}" y="${y - 8}" style="font-size: 8px;">₹${formatCompactPrice(val)}</text>` : ''}
    `;
  });

  // Base line
  svg += `<line class="chart-axis-line" x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" />`;
  svg += `</svg>`;
  container.innerHTML = svg;
}

// 3. Transactions Filtering, Sorting & Table Rendering
function applyFiltersAndRender() {
  const query = searchInput.value.toLowerCase().trim();
  const yearFilter = filterYear.value;
  const statusFilter = filterStatus.value;
  const sort = sortOrder.value;

  filteredOrders = scrapedOrders.filter(order => {
    // Check search query
    const matchQuery = 
      order.orderId.toLowerCase().includes(query) ||
      order.recipient.toLowerCase().includes(query) ||
      order.items.some(item => item.title.toLowerCase().includes(query));
      
    // Check year filter
    let matchYear = true;
    if (yearFilter !== 'all') {
      const d = parseDate(order.date);
      const y = d ? d.getFullYear() : (parseInt(order.date.match(/\d{4}/)) || null);
      matchYear = (y && y.toString() === yearFilter);
    }

    // Check status filter
    const matchStatus = (statusFilter === 'all' || order.status === statusFilter);

    return matchQuery && matchYear && matchStatus;
  });

  // Sorting
  filteredOrders.sort((a, b) => {
    if (sort === 'date-desc') {
      const dA = parseDate(a.date) || new Date(0);
      const dB = parseDate(b.date) || new Date(0);
      return dB - dA;
    } else if (sort === 'date-asc') {
      const dA = parseDate(a.date) || new Date(0);
      const dB = parseDate(b.date) || new Date(0);
      return dA - dB;
    } else if (sort === 'price-desc') {
      return cleanPrice(b.totalStr) - cleanPrice(a.totalStr);
    } else if (sort === 'price-asc') {
      return cleanPrice(a.totalStr) - cleanPrice(b.totalStr);
    }
    return 0;
  });

  // Update Page Index and render
  currentPage = 1;
  renderTable();
}

function renderTable() {
  ordersTableBody.innerHTML = '';
  
  const totalItems = filteredOrders.length;
  transactionCount.textContent = `Showing ${totalItems} orders`;

  if (totalItems === 0) {
    ordersTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No transactions match your search/filters.</td></tr>`;
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    pageInfo.textContent = 'Page 1 of 1';
    return;
  }

  const totalPages = Math.ceil(totalItems / pageSize);
  currentPage = Math.min(currentPage, totalPages);

  // Paginated slices
  const sliceStart = (currentPage - 1) * pageSize;
  const sliceEnd = Math.min(sliceStart + pageSize, totalItems);
  const pageOrders = filteredOrders.slice(sliceStart, sliceEnd);

  pageOrders.forEach(order => {
    const row = document.createElement('tr');
    
    // Status style classes
    let statusClass = 'status-delivered';
    if (order.status === 'Cancelled') statusClass = 'status-cancelled';
    if (order.status === 'Returned') statusClass = 'status-returned';
    if (order.status === 'Refunded') statusClass = 'status-cancelled';
    if (order.status === 'In Transit') statusClass = 'status-transit';

    // Build items lists
    let itemsHtml = '<div class="items-list">';
    order.items.forEach(item => {
      itemsHtml += `
        <div>
          <a class="item-link" href="${item.link}" target="_blank">${item.title}</a>
          <div class="item-meta">
            <span class="asin-badge">ASIN: ${item.asin}</span>
            <a href="https://www.amazon.in/gp/your-account/order-history/item-validation?orderID=${order.orderId}&asin=${item.asin}" target="_blank" style="color:var(--text-muted);text-decoration:none;">View Buy Link</a>
          </div>
        </div>
      `;
    });
    if (order.items.length === 0) {
      itemsHtml += `<span style="color:var(--text-muted);font-style:italic;">Product title not captured</span>`;
    }
    itemsHtml += '</div>';

    // Render cells
    row.innerHTML = `
      <td class="col-date">${order.date}</td>
      <td class="col-id">
        <a href="https://www.amazon.in/gp/your-account/order-details?orderID=${order.orderId}" target="_blank" style="color:inherit;text-decoration:underline;">${order.orderId}</a>
      </td>
      <td class="col-recipient">${order.recipient}</td>
      <td>${itemsHtml}</td>
      <td class="price-text">${order.totalStr}</td>
      <td><span class="status-badge ${statusClass}">${order.status}</span></td>
    `;
    
    ordersTableBody.appendChild(row);
  });

  // Update Pagination Controls
  prevPageBtn.disabled = (currentPage === 1);
  nextPageBtn.disabled = (currentPage === totalPages);
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

// 4. Export functions (CSV/JSON)
function exportData(format) {
  if (scrapedOrders.length === 0) {
    alert("No data available to export.");
    return;
  }

  // Use the currently filtered list or full list?
  // Let's ask or default to export ALL scraped data. The user has filters applied, so exporting the full list is best, with a small prompt.
  const dataToExport = scrapedOrders;

  if (format === 'csv') {
    const csvRows = [
      ["Order ID", "Date", "Recipient", "Total Price (INR)", "Status", "Items Purchased"]
    ];

    dataToExport.forEach(o => {
      csvRows.push([
        o.orderId,
        o.date,
        o.recipient,
        cleanPrice(o.totalStr).toString(),
        o.status,
        o.items.map(item => item.title).join('; ')
      ]);
    });

    const csvContent = csvRows.map(e => e.map(val => `"${(val || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `amazon_spends_${new Date().toISOString().split('T')[0]}.csv`);
  } else if (format === 'json') {
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `amazon_spends_${new Date().toISOString().split('T')[0]}.json`);
  }
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// General Utilities

// Parse Date string into JS Date object
function parseDate(dateStr) {
  if (!dateStr || dateStr.toLowerCase().includes('unknown')) return null;
  const ts = Date.parse(dateStr);
  if (!isNaN(ts)) {
    return new Date(ts);
  }
  return null;
}

// Convert string price to floating point number
function cleanPrice(priceStr) {
  if (!priceStr) return 0;
  // Keep only digits and decimal point
  let clean = priceStr.replace(/[^\d.]/g, '');
  let val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

// Format double value to INR currency string
function formatCurrency(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(val);
}

// Extract all unique years present in a list of orders
function extractUniqueYears(orders) {
  const years = new Set();
  orders.forEach(o => {
    const d = parseDate(o.date);
    const y = d ? d.getFullYear() : (parseInt(o.date.match(/\d{4}/)) || null);
    if (y) years.add(y);
  });
  return [...years].sort((a, b) => b - a);
}

// Format prices into compact strings (e.g. 1.2L or 14.5k)
function formatCompactPrice(val) {
  if (val >= 100000) {
    return (val / 100000).toFixed(1) + 'L';
  } else if (val >= 1000) {
    return (val / 1000).toFixed(1) + 'k';
  }
  return val.toFixed(0);
}
