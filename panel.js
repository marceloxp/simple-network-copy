const requests = [];
const seenRequests = new WeakSet();

const copyBtn = document.getElementById("copy-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const clearListBtn = document.getElementById("clear-list-btn");
const includeHeadersCheckbox = document.getElementById("include-headers");
const truncateEnabledCheckbox = document.getElementById("truncate-enabled");
const truncateMbInput = document.getElementById("truncate-mb");
const toastEl = document.getElementById("toast");
const requestsBody = document.getElementById("requests-body");
const requestsTable = document.getElementById("requests-table");
const emptyState = document.getElementById("empty-state");
const urlFilterInput = document.getElementById("url-filter");
const fetchXhrFilterBtn = document.getElementById("fetch-xhr-filter");
const filterEmptyState = document.getElementById("filter-empty-state");
const headerCheckbox = document.getElementById("header-checkbox");

const FETCH_XHR_TYPES = new Set(["fetch", "xhr"]);

function getUrlFilter() {
  return urlFilterInput.value.trim().toLowerCase();
}

function isFetchXhrFilterActive() {
  return fetchXhrFilterBtn.getAttribute("aria-pressed") === "true";
}

function isFetchXhrEntry(entry) {
  const type = getRequestType(entry.harEntry).toLowerCase();
  return FETCH_XHR_TYPES.has(type);
}

function hasActiveFilters() {
  return getUrlFilter().length > 0 || isFetchXhrFilterActive();
}

function entryMatchesFilter(entry) {
  if (isFetchXhrFilterActive() && !isFetchXhrEntry(entry)) {
    return false;
  }

  const filter = getUrlFilter();
  if (filter && !entry.harEntry.request.url.toLowerCase().includes(filter)) {
    return false;
  }

  return true;
}

function getVisibleEntries() {
  return requests.filter((entry) => entryMatchesFilter(entry));
}

function showToast(message, type = "success") {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} visible`;
  toastEl.hidden = false;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toastEl.classList.remove("visible");
    window.setTimeout(() => {
      toastEl.hidden = true;
    }, 200);
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getPayload(harEntry) {
  const postData = harEntry.request?.postData;
  if (!postData) return "";
  if (postData.text) return postData.text;
  if (postData.params?.length) {
    return postData.params.map((param) => `${param.name}=${param.value}`).join("&");
  }
  return "";
}

function getContentType(headers, fallback) {
  const header = headers?.find((item) => item.name.toLowerCase() === "content-type");
  return header?.value || fallback || "";
}

function looksLikeJson(text) {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

const MIME_TO_LANG = {
  "application/json": "json",
  "text/json": "json",
  "application/javascript": "javascript",
  "text/javascript": "javascript",
  "application/x-javascript": "javascript",
  "text/css": "css",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/xml": "xml",
  "text/xml": "xml",
  "image/svg+xml": "xml",
  "application/yaml": "yaml",
  "text/yaml": "yaml",
  "application/x-yaml": "yaml",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/sql": "sql",
  "text/sql": "sql",
  "application/graphql": "graphql",
  "text/plain": "text",
};

function mimeToLanguage(mimeType) {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  return MIME_TO_LANG[normalized] || "";
}

function detectLanguage(text, mimeType) {
  const fromMime = mimeToLanguage(mimeType);
  if (fromMime) return fromMime;
  if (!text) return "";
  if (looksLikeJson(text)) return "json";
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.includes("html")) return "html";
  if (lowerMime.includes("xml")) return "xml";
  if (lowerMime.includes("javascript")) return "javascript";
  if (lowerMime.includes("css")) return "css";
  return "";
}

function truncateBody(text, maxBytes) {
  if (!text) return { text: "", truncated: false };

  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return { text, truncated: false };
  }

  let slice = bytes.slice(0, maxBytes);
  while (slice.length > 0) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(slice);
      return {
        text:
          decoded +
          `\n\n... [truncated — ${formatBytes(bytes.length)} total, showing first ${formatBytes(maxBytes)}]`,
        truncated: true,
      };
    } catch {
      slice = slice.slice(0, -1);
    }
  }

  return { text: "[truncated]", truncated: true };
}

function formatHeadersTable(headers) {
  if (!headers?.length) return "";
  return headers.map((header) => `| ${header.name} | ${header.value} |`).join("\n");
}

function methodClass(method) {
  const normalized = method.toUpperCase();
  if (normalized === "GET") return "method-get";
  if (normalized === "POST") return "method-post";
  if (normalized === "PUT" || normalized === "PATCH") return "method-put";
  if (normalized === "DELETE") return "method-delete";
  return "method-other";
}

function statusClass(status) {
  if (status >= 200 && status < 300) return "status-ok";
  if (status >= 300 && status < 400) return "status-redirect";
  return "status-error";
}

function getResponseSize(harEntry) {
  if (harEntry.response.bodySize >= 0) return harEntry.response.bodySize;
  return harEntry.response.content?.size ?? 0;
}

function getRequestType(harEntry) {
  return harEntry._resourceType || harEntry.response?.content?.mimeType || "other";
}

function getSelectedEntries() {
  return requests.filter((entry) => entry.selected);
}

function updateToolbar() {
  const selectedCount = getSelectedEntries().length;
  copyBtn.textContent = `Copy (${selectedCount})`;
  copyBtn.disabled = selectedCount === 0;

  const visibleEntries = getVisibleEntries();
  const selectedVisibleCount = visibleEntries.filter((entry) => entry.selected).length;
  const allVisibleSelected =
    visibleEntries.length > 0 && selectedVisibleCount === visibleEntries.length;
  headerCheckbox.checked = allVisibleSelected;
  headerCheckbox.indeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleEntries.length;
  headerCheckbox.disabled = visibleEntries.length === 0;

  truncateMbInput.disabled = !truncateEnabledCheckbox.checked;
}

function applyFilters() {
  requests.forEach((entry) => {
    const row = requestsBody.querySelector(`tr[data-id="${entry.id}"]`);
    if (!row) return;
    row.classList.toggle("row-hidden", !entryMatchesFilter(entry));
  });
  updateEmptyState();
  updateToolbar();
}

function updateEmptyState() {
  const hasRequests = requests.length > 0;
  const visibleCount = getVisibleEntries().length;
  const hasFilter = hasActiveFilters();

  emptyState.classList.toggle("hidden", hasRequests);
  filterEmptyState.classList.toggle("hidden", !hasRequests || visibleCount > 0 || !hasFilter);
  requestsTable.classList.toggle("hidden", !hasRequests || (hasFilter && visibleCount === 0));
}

function addRequest(harEntry) {
  if (seenRequests.has(harEntry)) return;
  seenRequests.add(harEntry);

  const entry = {
    id: requests.length + 1,
    harEntry,
    selected: false,
  };
  requests.push(entry);
  renderRequestRow(entry);
  applyFilters();
}

function renderRequestRow(entry) {
  const { harEntry } = entry;
  const row = document.createElement("tr");
  row.dataset.id = String(entry.id);

  const method = harEntry.request.method;
  const status = harEntry.response.status;
  const url = harEntry.request.url;
  const size = getResponseSize(harEntry);

  row.innerHTML = `
    <td class="col-check">
      <input type="checkbox" class="row-checkbox" data-id="${entry.id}" />
    </td>
    <td class="col-method">
      <span class="method-badge ${methodClass(method)}">${method}</span>
    </td>
    <td class="col-status ${statusClass(status)}">${status || "—"}</td>
    <td class="col-type" title="${getRequestType(harEntry)}">${getRequestType(harEntry)}</td>
    <td class="col-url" title="${url}">${url}</td>
    <td class="col-size">${formatBytes(size)}</td>
  `;

  const checkbox = row.querySelector(".row-checkbox");
  checkbox.checked = entry.selected;
  row.classList.toggle("selected", entry.selected);

  checkbox.addEventListener("change", () => {
    entry.selected = checkbox.checked;
    row.classList.toggle("selected", entry.selected);
    updateToolbar();
  });

  requestsBody.appendChild(row);
}

function getResponseContent(harEntry) {
  return new Promise((resolve) => {
    harEntry.getContent((content, encoding) => {
      if (encoding === "base64") {
        resolve("[binary content — not included]");
        return;
      }
      resolve(content || "");
    });
  });
}

function getCopyOptions() {
  const truncateMb = Number.parseFloat(truncateMbInput.value);
  return {
    includeHeaders: includeHeadersCheckbox.checked,
    truncateEnabled: truncateEnabledCheckbox.checked,
    truncateMb: Number.isFinite(truncateMb) && truncateMb > 0 ? truncateMb : 3,
  };
}

async function buildMarkdown(selectedEntries, options) {
  const maxBytes = options.truncateMb * 1024 * 1024;
  const sections = [];

  for (let index = 0; index < selectedEntries.length; index += 1) {
    const { harEntry } = selectedEntries[index];
    const method = harEntry.request.method;
    const url = harEntry.request.url;
    const status = harEntry.response.status;
    let payload = getPayload(harEntry);
    let response = await getResponseContent(harEntry);

    if (options.truncateEnabled) {
      payload = truncateBody(payload, maxBytes).text;
      response = truncateBody(response, maxBytes).text;
    }

    const lines = [
      `## Request ${index + 1}`,
      "",
      `- Method: ${method}`,
      `- URL: ${url}`,
      `- Status: ${status}`,
      "",
    ];

    if (options.includeHeaders) {
      const requestHeaders = formatHeadersTable(harEntry.request.headers);
      const responseHeaders = formatHeadersTable(harEntry.response.headers);

      if (requestHeaders) {
        lines.push("### Request Headers", "| Header | Value |", "| --- | --- |", requestHeaders, "");
      }
      if (responseHeaders) {
        lines.push("### Response Headers", "| Header | Value |", "| --- | --- |", responseHeaders, "");
      }
    }

    if (payload) {
      const payloadMime = getContentType(harEntry.request.headers);
      const payloadLang = detectLanguage(payload, payloadMime);
      lines.push("### Payload", "", "```" + payloadLang, payload, "```", "");
    }

    const responseMime = getContentType(
      harEntry.response.headers,
      harEntry.response.content?.mimeType || ""
    );
    const responseLang = detectLanguage(response, responseMime);
    lines.push("### Response", "", "```" + responseLang, response || "[empty]", "```");

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}

async function copySelected() {
  const selectedEntries = getSelectedEntries();
  if (selectedEntries.length === 0) return;

  copyBtn.disabled = true;
  try {
    const markdown = await buildMarkdown(selectedEntries, getCopyOptions());
    await navigator.clipboard.writeText(markdown);
    showToast(`Copied ${selectedEntries.length} request(s) to clipboard.`);
  } catch (error) {
    showToast(`Copy failed: ${error.message}`, "error");
  } finally {
    updateToolbar();
  }
}

function setAllSelected(selected, visibleOnly = false) {
  const targets = visibleOnly ? getVisibleEntries() : requests;
  targets.forEach((entry) => {
    entry.selected = selected;
    const row = requestsBody.querySelector(`tr[data-id="${entry.id}"]`);
    if (!row) return;
    row.querySelector(".row-checkbox").checked = selected;
    row.classList.toggle("selected", selected);
  });
  updateToolbar();
}

function clearList() {
  requests.length = 0;
  requestsBody.innerHTML = "";
  applyFilters();
}

copyBtn.addEventListener("click", copySelected);
selectAllBtn.addEventListener("click", () => setAllSelected(true, true));
clearSelectionBtn.addEventListener("click", () => setAllSelected(false));
clearListBtn.addEventListener("click", clearList);
headerCheckbox.addEventListener("change", () => setAllSelected(headerCheckbox.checked, true));
urlFilterInput.addEventListener("input", applyFilters);
fetchXhrFilterBtn.addEventListener("click", () => {
  const active = !isFetchXhrFilterActive();
  fetchXhrFilterBtn.setAttribute("aria-pressed", String(active));
  applyFilters();
});
truncateEnabledCheckbox.addEventListener("change", updateToolbar);
truncateMbInput.addEventListener("input", updateToolbar);

chrome.devtools.network.onRequestFinished.addListener(addRequest);
chrome.devtools.network.getHAR((harLog) => {
  harLog.entries.forEach(addRequest);
});

updateToolbar();
applyFilters();
