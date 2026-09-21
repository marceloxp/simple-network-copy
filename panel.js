const requests = [];
let seenRequests = new WeakSet();

const copyBtn = document.getElementById("copy-btn");
const copyBtnLabel = document.getElementById("copy-btn-label");
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
const apiFilterBtn = document.getElementById("api-filter");
const preserveLogCheckbox = document.getElementById("preserve-log");
const filterEmptyState = document.getElementById("filter-empty-state");
const headerCheckbox = document.getElementById("header-checkbox");
const previewEnabledCheckbox = document.getElementById("preview-enabled");
const mainSplit = document.querySelector(".main-split");
const previewSplitter = document.getElementById("preview-splitter");
const previewPane = document.getElementById("preview-pane");
const previewTitle = document.getElementById("preview-title");
const previewBody = document.getElementById("preview-body");
const previewEmpty = document.getElementById("preview-empty");
const previewCopyBtn = document.getElementById("preview-copy-btn");

const PREVIEW_STORAGE_KEY = "snc-preview-enabled";
const PREVIEW_HEIGHT_KEY = "snc-preview-height";
const PREVIEW_MIN_HEIGHT = 80;
const TABLE_MIN_HEIGHT = 80;
const PREVIEW_DEFAULT_HEIGHT = 180;

let previewMarkdown = "";
let focusedEntry = null;
let previewGeneration = 0;
let previewPaneHeight = PREVIEW_DEFAULT_HEIGHT;

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

function isApiFilterActive() {
  return apiFilterBtn.getAttribute("aria-pressed") === "true";
}

function hasActiveFilters() {
  return getUrlFilter().length > 0 || isFetchXhrFilterActive() || isApiFilterActive();
}

function entryMatchesFilter(entry) {
  if (isFetchXhrFilterActive() && !isFetchXhrEntry(entry)) {
    return false;
  }

  if (isApiFilterActive() && !isApiEntry(entry)) {
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

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const TIMING_PHASES = [
  ["blocked", "blocked"],
  ["dns", "dns"],
  ["connect", "connect"],
  ["send", "send"],
  ["wait", "TTFB"],
  ["receive", "download"],
];

function formatTimingBreakdown(harEntry) {
  const timings = harEntry.timings;
  if (!timings) return "—";

  const parts = TIMING_PHASES
    .filter(([key]) => Number.isFinite(timings[key]) && timings[key] > 0)
    .map(([key, label]) => `${label} ${formatDuration(timings[key])}`);

  return parts.length > 0 ? parts.join(" · ") : "—";
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

function getResponseContentType(harEntry) {
  return getContentType(harEntry.response.headers, harEntry.response.content?.mimeType || "");
}

function isApiResponseType(mimeType) {
  const base = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (!base) return false;
  if (base === "application/json" || base === "text/json") return true;
  if (base.endsWith("+json")) return true;
  if (base === "application/xml" || base === "text/xml") return true;
  return false;
}

function isApiEntry(entry) {
  return isApiResponseType(getResponseContentType(entry.harEntry));
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
  copyBtnLabel.textContent = `Copy (${selectedCount})`;
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
    <td class="col-size">
      <span class="size-text">${formatBytes(size)}</span>
      <div class="row-overlay" aria-hidden="true">
        <button type="button" class="row-action-btn row-copy-btn">Copy</button>
        <button type="button" class="row-action-btn row-preview-btn">Preview</button>
      </div>
    </td>
  `;

  const checkbox = row.querySelector(".row-checkbox");
  checkbox.checked = entry.selected;
  row.classList.toggle("selected", entry.selected);

  checkbox.addEventListener("change", () => {
    entry.selected = checkbox.checked;
    row.classList.toggle("selected", entry.selected);
    updateToolbar();
  });

  row.addEventListener("click", (event) => {
    if (event.target.closest("input, button")) return;
    setFocusedEntry(entry);
  });

  row.querySelector(".row-copy-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    event.currentTarget.blur();
    copyEntries([entry]);
  });

  row.querySelector(".row-preview-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    event.currentTarget.blur();
    setFocusedEntry(entry, { openPanel: true });
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
      `- Duration: ${formatDuration(harEntry.time)}`,
      `- Timing: ${formatTimingBreakdown(harEntry)}`,
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

async function copyEntries(entries) {
  if (entries.length === 0) return;

  try {
    const markdown = await buildMarkdown(entries, getCopyOptions());
    await navigator.clipboard.writeText(markdown);
    const label = entries.length === 1 ? "1 request" : `${entries.length} requests`;
    showToast(`Copied ${label} to clipboard.`);
  } catch (error) {
    showToast(`Copy failed: ${error.message}`, "error");
  }
}

async function copySelected() {
  const selectedEntries = getSelectedEntries();
  if (selectedEntries.length === 0) return;

  copyBtn.disabled = true;
  try {
    await copyEntries(selectedEntries);
  } finally {
    updateToolbar();
  }
}

function isPreviewEnabled() {
  return previewEnabledCheckbox.checked;
}

function readStoredNumber(key) {
  try {
    const value = Number.parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function persistPreviewPrefs() {
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, isPreviewEnabled() ? "1" : "0");
    localStorage.setItem(PREVIEW_HEIGHT_KEY, String(Math.round(previewPaneHeight)));
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

function clampPreviewHeight(height) {
  const splitHeight = mainSplit.getBoundingClientRect().height;
  const splitterHeight = isPreviewEnabled() ? previewSplitter.getBoundingClientRect().height || 5 : 5;
  const maxHeight = Math.max(PREVIEW_MIN_HEIGHT, splitHeight - TABLE_MIN_HEIGHT - splitterHeight);
  return Math.min(maxHeight, Math.max(PREVIEW_MIN_HEIGHT, height));
}

function applyPreviewLayout() {
  const visible = isPreviewEnabled();
  previewSplitter.classList.toggle("hidden", !visible);
  previewPane.classList.toggle("hidden", !visible);
  document.body.classList.toggle("preview-open", visible);
  if (visible) {
    previewPaneHeight = clampPreviewHeight(previewPaneHeight);
    previewPane.style.height = `${previewPaneHeight}px`;
    previewSplitter.setAttribute("aria-valuemin", String(PREVIEW_MIN_HEIGHT));
    previewSplitter.setAttribute(
      "aria-valuemax",
      String(Math.round(clampPreviewHeight(Number.POSITIVE_INFINITY)))
    );
    previewSplitter.setAttribute("aria-valuenow", String(Math.round(previewPaneHeight)));
  }
  updateFocusedRowClass();
}

function showPreviewEmpty() {
  previewTitle.textContent = "Preview";
  previewMarkdown = "";
  previewBody.textContent = "";
  previewBody.classList.add("hidden");
  previewEmpty.classList.remove("hidden");
  previewCopyBtn.disabled = true;
}

function showPreviewBody() {
  previewEmpty.classList.add("hidden");
  previewBody.classList.remove("hidden");
}

function updateFocusedRowClass() {
  requestsBody.querySelectorAll("tr.focused").forEach((row) => {
    row.classList.remove("focused");
  });
  if (!focusedEntry || !isPreviewEnabled()) return;
  const row = requestsBody.querySelector(`tr[data-id="${focusedEntry.id}"]`);
  row?.classList.add("focused");
}

function setFocusedEntry(entry, options = {}) {
  if (options.openPanel && !isPreviewEnabled()) {
    previewEnabledCheckbox.checked = true;
    persistPreviewPrefs();
    applyPreviewLayout();
  }

  const sameEntry = focusedEntry === entry;
  if (!sameEntry) {
    focusedEntry = entry;
    previewMarkdown = "";
    updateFocusedRowClass();
  }

  if (!sameEntry || options.openPanel || options.forceRefresh) {
    refreshPreview();
  }
}

function schedulePreviewRefresh() {
  window.clearTimeout(schedulePreviewRefresh._timer);
  schedulePreviewRefresh._timer = window.setTimeout(() => {
    refreshPreview();
  }, 200);
}

async function refreshPreview() {
  if (!isPreviewEnabled()) return;

  const generation = (previewGeneration += 1);

  if (!focusedEntry) {
    showPreviewEmpty();
    return;
  }

  const { harEntry } = focusedEntry;
  previewTitle.textContent = `${harEntry.request.method} ${harEntry.request.url}`;
  showPreviewBody();
  if (!previewMarkdown) {
    previewBody.textContent = "Loading...";
  }
  previewCopyBtn.disabled = true;

  try {
    const markdown = await buildMarkdown([focusedEntry], getCopyOptions());
    if (generation !== previewGeneration) return;
    previewMarkdown = markdown;
    previewBody.textContent = markdown;
    previewCopyBtn.disabled = false;
  } catch (error) {
    if (generation !== previewGeneration) return;
    previewMarkdown = "";
    previewBody.textContent = `Failed to load preview: ${error.message}`;
    previewCopyBtn.disabled = true;
    showToast(`Preview failed: ${error.message}`, "error");
  }
}

async function copyPreviewMarkdown() {
  if (!previewMarkdown) return;

  try {
    await navigator.clipboard.writeText(previewMarkdown);
    showToast("Copied preview to clipboard.");
  } catch (error) {
    showToast(`Copy failed: ${error.message}`, "error");
  }
}

function startSplitterDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  previewSplitter.setPointerCapture(event.pointerId);
  document.body.classList.add("splitting");

  const startY = event.clientY;
  const startHeight = previewPane.getBoundingClientRect().height;

  function onMove(moveEvent) {
    const delta = startY - moveEvent.clientY;
    previewPaneHeight = clampPreviewHeight(startHeight + delta);
    previewPane.style.height = `${previewPaneHeight}px`;
    previewSplitter.setAttribute("aria-valuenow", String(Math.round(previewPaneHeight)));
  }

  function onUp() {
    previewSplitter.removeEventListener("pointermove", onMove);
    previewSplitter.removeEventListener("pointerup", onUp);
    previewSplitter.removeEventListener("pointercancel", onUp);
    previewSplitter.removeEventListener("lostpointercapture", onUp);
    document.body.classList.remove("splitting");
    persistPreviewPrefs();
  }

  previewSplitter.addEventListener("pointermove", onMove);
  previewSplitter.addEventListener("pointerup", onUp);
  previewSplitter.addEventListener("pointercancel", onUp);
  previewSplitter.addEventListener("lostpointercapture", onUp);
}

function loadPreviewPrefs() {
  try {
    previewEnabledCheckbox.checked = localStorage.getItem(PREVIEW_STORAGE_KEY) === "1";
  } catch {
    previewEnabledCheckbox.checked = false;
  }
  const storedHeight = readStoredNumber(PREVIEW_HEIGHT_KEY);
  if (storedHeight !== null) {
    previewPaneHeight = storedHeight;
  }
  applyPreviewLayout();
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
  seenRequests = new WeakSet();
  focusedEntry = null;
  previewGeneration += 1;
  applyFilters();
  refreshPreview();
}

function handleNavigation() {
  if (!preserveLogCheckbox.checked) {
    clearList();
  }
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
apiFilterBtn.addEventListener("click", () => {
  const active = !isApiFilterActive();
  apiFilterBtn.setAttribute("aria-pressed", String(active));
  applyFilters();
});
includeHeadersCheckbox.addEventListener("change", refreshPreview);
truncateEnabledCheckbox.addEventListener("change", () => {
  updateToolbar();
  refreshPreview();
});
truncateMbInput.addEventListener("input", () => {
  updateToolbar();
  schedulePreviewRefresh();
});
previewEnabledCheckbox.addEventListener("change", () => {
  persistPreviewPrefs();
  applyPreviewLayout();
  refreshPreview();
});
previewCopyBtn.addEventListener("click", copyPreviewMarkdown);
previewSplitter.addEventListener("pointerdown", startSplitterDrag);
previewSplitter.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const delta = event.key === "ArrowUp" ? 16 : -16;
  previewPaneHeight = clampPreviewHeight(previewPaneHeight + delta);
  previewPane.style.height = `${previewPaneHeight}px`;
  previewSplitter.setAttribute("aria-valuenow", String(Math.round(previewPaneHeight)));
  persistPreviewPrefs();
});
window.addEventListener("resize", () => {
  if (!isPreviewEnabled()) return;
  applyPreviewLayout();
});

chrome.devtools.network.onRequestFinished.addListener(addRequest);
chrome.devtools.network.onNavigated.addListener(handleNavigation);
chrome.devtools.network.getHAR((harLog) => {
  harLog.entries.forEach(addRequest);
});

loadPreviewPrefs();
updateToolbar();
applyFilters();
refreshPreview();
