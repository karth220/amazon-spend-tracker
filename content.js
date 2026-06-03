// content.js - Amazon.in Spend Analyzer Scraping Engine

console.log("Amazon.in Spend Analyzer Content Script loaded.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true, status: 'active' });
    return false; // Respond synchronously
  }
  if (request.action === 'scrape_page') {
    const { year, startIndex } = request;
    scrapePage(year, startIndex)
      .then(result => {
        sendResponse(result);
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

// Helper to request background page fetches with credentials
function fetchPageFromBackground(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'fetch_url', url: url }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!response) {
        reject(new Error("No response received from service worker"));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error || "Background fetch failed"));
        return;
      }
      resolve(response.text);
    });
  });
}

/**
 * Scrapes a single page of Amazon orders for a specific year.
 * Handles fetching, CAPTCHA detection, parsing, and returns structured data.
 */
async function scrapePage(year, startIndex) {
  // Use absolute URLs for background service worker fetch requests
  const urls = [
    `https://www.amazon.in/your-orders/orders?timeFilter=year-${year}&startIndex=${startIndex}`,
    `https://www.amazon.in/gp/your-account/order-history?orderFilter=year-${year}&startIndex=${startIndex}`,
    `https://www.amazon.in/gp/css/order-history?opt=history&year=${year}&startIndex=${startIndex}`
  ];

  let htmlText = '';
  let fetchError = null;
  let successUrl = '';

  for (const url of urls) {
    try {
      htmlText = await fetchPageFromBackground(url);
      if (htmlText) {
        successUrl = url;
        break;
      }
    } catch (e) {
      fetchError = e;
      console.warn(`Background fetch failed for URL: ${url}. Error: ${e.message}`);
    }
  }

  if (!htmlText) {
    throw new Error(fetchError ? fetchError.message : "Failed to fetch order page from Amazon.in.");
  }

  // Check for CAPTCHA or Robot verification page
  if (
    htmlText.includes('captcha') || 
    htmlText.includes('Robot Check') || 
    htmlText.includes('enter the characters you see below') ||
    htmlText.includes('automated access')
  ) {
    return { success: false, isCaptcha: true };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');

  // Check if it's a login page
  const isLogin = htmlText.includes('ap/signin') || htmlText.includes('signin') || doc.title.includes('Sign In') || doc.title.includes('Sign-in') || htmlText.includes('nav-signin-text');
  if (isLogin) {
    return { success: false, isLoggedOut: true };
  }

  let availableYears = [];
  if (startIndex === 0) {
    const select = doc.querySelector('select[name="timeFilter"], select[name="orderFilter"]');
    if (select) {
      select.querySelectorAll('option').forEach(opt => {
        const val = opt.value;
        const match = val.match(/year-(\d{4})/);
        if (match) {
          availableYears.push(parseInt(match[1]));
        } else if (/^\d{4}$/.test(val)) {
          availableYears.push(parseInt(val));
        }
      });
    }
  }

  // Find all order cards
  const orderCards = doc.querySelectorAll('.order-card, .order, .a-box-group, div[class*="order-card"], div[id*="orderCard"]');
  const orders = [];

  orderCards.forEach(card => {
    try {
      const parsed = parseOrderCard(card);
      if (parsed) {
        orders.push(parsed);
      }
    } catch (e) {
      console.error("Failed to parse individual order card:", e);
    }
  });

  // Diagnostics collect
  let diagnostics = null;
  if (orders.length === 0) {
    diagnostics = {
      title: doc.title,
      fetchedUrl: successUrl,
      htmlLength: htmlText.length,
      divCount: doc.querySelectorAll('div').length,
      boxGroupCount: doc.querySelectorAll('.a-box-group').length,
      orderClassCount: doc.querySelectorAll('.order').length,
      orderCardCount: doc.querySelectorAll('.order-card').length,
      orderCardWildcardCount: doc.querySelectorAll('div[class*="order-card"]').length,
      orderDetailsLinkCount: doc.querySelectorAll('a[href*="order-details"], a[href*="orderID="]').length,
      bodySnippet: doc.body ? doc.body.textContent.replace(/\s+/g, ' ').substring(0, 500) : "No body content"
    };
    console.log("Scraper Diagnostics (0 orders):", diagnostics);
  }

  return {
    success: true,
    orders,
    years: availableYears.length > 0 ? availableYears : null,
    hasNextPage: orderCards.length >= 10 && orders.length > 0,
    diagnostics
  };
}

/**
 * Parses a single order card DOM element using a highly resilient algorithm.
 * It combines specific CSS selectors with generic regex-based text analysis.
 */
function parseOrderCard(card) {
  // Amazon cards usually have a header row containing meta details, and a body row for items.
  const headerEl = card.querySelector('.js-order-card-header, div[class*="header"], .a-box:first-child');
  const headerText = headerEl ? headerEl.textContent.replace(/\s+/g, ' ').trim() : "";
  const cardText = card.textContent.replace(/\s+/g, ' ').trim();

  let orderId = null;
  let date = null;
  let totalStr = null;
  let recipient = null;

  // 1. Extract Order ID
  // Look for standard Amazon order ID format: XXX-XXXXXXX-XXXXXXX (digits)
  const idMatch = cardText.match(/(\d{3}-\d{7}-\d{7})/);
  if (idMatch) {
    orderId = idMatch[1];
  } else {
    // Fallback: Search for detail links that contain order ID parameters
    const detailsLink = card.querySelector('a[href*="orderID="], a[href*="order-details"]');
    if (detailsLink) {
      const href = detailsLink.getAttribute('href');
      const paramMatch = href.match(/orderID=([A-Z0-9-]+)/i);
      if (paramMatch) {
        orderId = paramMatch[1];
      }
    }
  }

  // If we can't find an order ID, this element might not be an actual order card
  if (!orderId) {
    return null;
  }

  // 2. Extract Order Date
  // Look for standard date format in India: D Month YYYY (e.g., 24 May 2024 or 03 June 2026)
  const datePattern = /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i;
  
  if (headerText) {
    const dateMatch = headerText.match(datePattern);
    if (dateMatch) {
      date = dateMatch[1];
    }
  }
  if (!date) {
    const dateMatch = cardText.match(datePattern);
    if (dateMatch) {
      date = dateMatch[1];
    }
  }
  // Sibling selector fallback if regex fails
  if (!date) {
    const elements = card.querySelectorAll('span, div, td, p');
    for (let el of elements) {
      if (/order\s+placed/i.test(el.textContent)) {
        const nextEl = el.nextElementSibling || el.parentElement.querySelector('.a-color-value');
        if (nextEl) {
          date = nextEl.textContent.trim();
          break;
        }
      }
    }
  }

  // 3. Extract Total Price
  // Matches currency indicators like ₹, Rs, INR, $, £, € followed by digits and optional decimals
  const pricePattern = /(?:₹|Rs\.?|INR|\$|£|€)\s*([\d,]+\.\d{2})/i;
  const pricePatternNoDec = /(?:₹|Rs\.?|INR|\$|£|€)\s*([\d,]+)/i;
  
  if (headerText) {
    const priceMatch = headerText.match(pricePattern) || headerText.match(pricePatternNoDec);
    if (priceMatch) {
      totalStr = priceMatch[0];
    }
  }
  if (!totalStr) {
    const priceMatch = cardText.match(pricePattern) || cardText.match(pricePatternNoDec);
    if (priceMatch) {
      totalStr = priceMatch[0];
    }
  }
  // Selector fallback if regex fails
  if (!totalStr) {
    const priceEl = card.querySelector('.order-total, .a-color-price, .price, span.value, [class*="total-amount"]');
    if (priceEl) {
      totalStr = priceEl.textContent.trim();
    }
  }

  // 4. Extract Recipient (Ship To)
  if (headerText) {
    const shipToMatch = headerText.match(/ship\s+to\s+([^\n\d#]+)/i);
    if (shipToMatch) {
      recipient = shipToMatch[1].trim();
      // Clean up dropdown tags or popover links in recipient text
      recipient = recipient.split(' ')[0] + (recipient.split(' ')[1] ? ' ' + recipient.split(' ')[1] : '');
    }
  }
  if (!recipient) {
    const recipientEl = card.querySelector('.recipient, [class*="recipient"], a[id*="recipient"], span.a-declarative');
    if (recipientEl && !recipientEl.textContent.toLowerCase().includes('order')) {
      recipient = recipientEl.textContent.trim();
    }
  }

  // 5. Extract Items List
  const items = [];
  const seenAsins = new Set();
  
  // Amazon product page links contain '/dp/ASIN' or '/gp/product/ASIN'
  const links = card.querySelectorAll('a[href*="/gp/product/"], a[href*="/dp/"], a[href*="/gp/aw/d/"]');
  
  links.forEach(link => {
    const href = link.getAttribute('href') || "";
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})|\/product\/([A-Z0-9]{10})|\/gp\/aw\/d\/([A-Z0-9]{10})/);
    
    if (asinMatch) {
      const asin = asinMatch[1] || asinMatch[2] || asinMatch[3];
      
      let title = link.textContent.trim();
      // If title link is empty (usually it houses the image), check image alt tags or ignore
      if (!title) {
        const img = link.querySelector('img');
        if (img) {
          title = img.getAttribute('alt') || "";
        }
      }
      
      title = title.replace(/\s+/g, ' ').trim();
      
      if (title && !seenAsins.has(asin)) {
        seenAsins.add(asin);
        items.push({
          asin,
          title,
          link: 'https://www.amazon.in' + href.split('?')[0]
        });
      }
    }
  });

  // 6. Extract Order Status
  let status = "Delivered";
  if (/cancelled/i.test(cardText)) {
    status = "Cancelled";
  } else if (/returned/i.test(cardText)) {
    status = "Returned";
  } else if (/refunded/i.test(cardText)) {
    status = "Refunded";
  } else if (/arriving/i.test(cardText) || /on the way/i.test(cardText) || /shipped/i.test(cardText) || /dispatch/i.test(cardText)) {
    status = "In Transit";
  } else if (/delivered/i.test(cardText)) {
    status = "Delivered";
  }

  return {
    orderId,
    date: date || 'Unknown Date',
    totalStr: totalStr || '₹0.00',
    recipient: recipient || 'Self',
    items,
    status
  };
}
