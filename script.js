// ---------- DOM refs ----------
const toggleBtn = document.getElementById("toggle-theme");
const loader = document.getElementById("loader");
const resultsDiv = document.getElementById("results");
const bookmarksDiv = document.getElementById("bookmarks");
const showBookmarksBtn = document.getElementById("show-bookmarks");
const clearBookmarksBtn = document.getElementById("clear-bookmarks");
const bookmarksSection = document.getElementById("bookmarks-section");
const bookmarkCount = document.getElementById("bookmark-count");
const searchBtn = document.getElementById("search-btn");
const pieCanvas = document.getElementById("pieChart");
const toast = document.getElementById("toast");

// Panel summarizer
const summaryInput = document.getElementById("summary-input");
const summaryOutput = document.getElementById("summary-output");
const summarizeFreeBtn = document.getElementById("summarize-free");
const summarizeOpenAIBtn = document.getElementById("summarize-openai");

// ---------- State ----------
let pieChart = null;
let bookmarks = JSON.parse(localStorage.getItem("bookmarkedIssues") || "[]");
let lastResults = [];
const issueMap = new Map(); // id -> issue

// ---------- Theme (default: light, toggle adds .dark) ----------
(function initTheme() {
  const saved = localStorage.getItem("theme") || "light";
  if (saved === "dark") document.body.classList.add("dark");
})();
toggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
});

// ---------- Search ----------
searchBtn.addEventListener("click", searchIssues);

function searchIssues() {
  const query = document.getElementById("searchInput").value.trim();
  const type = document.getElementById("search-type").value;
  if (!query) return alert("Please enter a search term!");

  loader.style.display = "block";
  resultsDiv.innerHTML = "";

  let url;
  if (type === "language") {
    url = `https://api.github.com/search/issues?q=label:"good first issue"+language:${encodeURIComponent(query)}+state:open&sort=created&order=desc`;
  } else {
    url = `https://api.github.com/search/issues?q=label:"good first issue"+repo:${encodeURIComponent(query)}+state:open&sort=created&order=desc`;
  }

  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      loader.style.display = "none";
      if (!data.items || data.items.length === 0) {
        resultsDiv.innerHTML = "<p>No issues found.</p>";
        lastResults = [];
        return;
      }
      lastResults = data.items;
      issueMap.clear();
      lastResults.forEach((iss) => issueMap.set(iss.id, iss));
      renderIssues(lastResults, resultsDiv);
      showToast(`Found ${lastResults.length} issues`);
    })
    .catch((err) => {
      loader.style.display = "none";
      resultsDiv.innerHTML = "<p>Error fetching issues.</p>";
      console.error(err);
      showToast("Fetch error. Try again.");
    });
}

// ---------- Render ----------
function renderIssues(items, container) {
  container.innerHTML = "";
  items.forEach((issue) => {
    if (issue?.id) issueMap.set(issue.id, issue);

    const repoFull = issue.repository_url.split("/").slice(-2).join("/");
    const saved = isBookmarked(issue.id);

    const card = document.createElement("div");
    card.className = "issue-card";
    card.innerHTML = `
      <h3>${escapeHtml(issue.title)}</h3>
      <div class="issue-meta">🧑‍💻 ${repoFull}</div>
      <div class="card-actions">
        <a class="view-link" href="${issue.html_url}" target="_blank" rel="noopener">🔗 View Issue</a>
        <button class="btn-outline btn-bookmark" data-id="${issue.id}">${saved ? "⭐ Remove" : "⭐ Bookmark"}</button>
        <button class="btn-primary btn-summarize" data-id="${issue.id}">🧠 Summarize</button>
      </div>
      <div class="issue-summary" id="summary-${issue.id}" aria-live="polite"></div>
    `;

    // Bookmark toggle
    card.querySelector(".btn-bookmark").addEventListener("click", (e) => {
      const id = Number(e.currentTarget.dataset.id);
      toggleBookmarkById(id);

      // Refresh lists & chart
      renderIssues(container === resultsDiv ? lastResults : bookmarks, container);
      renderIssues(bookmarks, bookmarksDiv);
      updateBookmarkCount();
      renderBookmarkPieByLanguage();
    });

    // Per-card summarize
    card.querySelector(".btn-summarize").addEventListener("click", async () => {
      const id = issue.id;
      const iss = issueMap.get(id) || bookmarks.find((b) => b.id === id);
      const target = card.querySelector(`#summary-${id}`);
      target.textContent = "Summarizing...";

      const repoFullLocal = iss?.repository_url?.split("/").slice(-2).join("/") || "";
      const text = (iss?.body || `${iss?.title || ""} – ${repoFullLocal}`).toString();

      const s = await smartSummarize(text);
      target.innerHTML = `<strong>Summary:</strong> ${escapeHtml(s)}`;
    });

    container.appendChild(card);
  });
}

// ---------- Bookmarks ----------
function isBookmarked(id) {
  return bookmarks.some((i) => i.id === id);
}
function toggleBookmarkById(id) {
  const exists = isBookmarked(id);
  if (exists) {
    bookmarks = bookmarks.filter((i) => i.id !== id);
    showToast("Removed from bookmarks");
  } else {
    const issue = issueMap.get(id);
    if (issue) bookmarks.push(issue);
    showToast("Bookmarked ✔");
  }
  localStorage.setItem("bookmarkedIssues", JSON.stringify(bookmarks));
}
function updateBookmarkCount() {
  bookmarkCount.textContent = bookmarks.length;
}

showBookmarksBtn.addEventListener("click", () => {
  const hidden = bookmarksSection.style.display === "none" || !bookmarksSection.style.display;
  bookmarksSection.style.display = hidden ? "block" : "none";
  renderIssues(bookmarks, bookmarksDiv);
  updateBookmarkCount();
  renderBookmarkPieByLanguage();
  if (hidden) setTimeout(() => bookmarksSection.scrollIntoView({ behavior:"smooth" }), 80);
});
clearBookmarksBtn.addEventListener("click", () => {
  if (bookmarks.length && confirm("Clear all bookmarks?")) {
    bookmarks = [];
    localStorage.setItem("bookmarkedIssues","[]");
    renderIssues(bookmarks, bookmarksDiv);
    updateBookmarkCount();
    renderBookmarkPieByLanguage();
    showToast("All bookmarks cleared");
  }
});

// ---------- Pie chart: Bookmarks by LANGUAGE ----------
async function renderBookmarkPieByLanguage() {
  if (!pieCanvas) return;

  const repoCounts = {};
  const repos = new Set();
  bookmarks.forEach((iss) => {
    const repoFull = iss.repository_url.split("/").slice(-2).join("/");
    repos.add(repoFull);
    repoCounts[repoFull] = (repoCounts[repoFull] || 0) + 1;
  });

  if (repos.size === 0) { if (pieChart) { pieChart.destroy(); pieChart = null; } return; }

  const langCounts = {};
  await Promise.all(Array.from(repos).map(async (repoFull) => {
    try {
      const r = await fetch(`https://api.github.com/repos/${repoFull}`);
      const d = await r.json();
      const lang = d?.language || "Unknown";
      langCounts[lang] = (langCounts[lang] || 0) + (repoCounts[repoFull] || 1);
    } catch {
      langCounts["Unknown"] = (langCounts["Unknown"] || 0) + (repoCounts[repoFull] || 1);
    }
  }));

  const labels = Object.keys(langCounts);
  const data = Object.values(langCounts);

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(pieCanvas, {
    type: "pie",
    data: {
      labels,
      datasets: [{ data, backgroundColor: ["#3b82f6","#60a5fa","#93c5fd","#1d4ed8","#2563eb","#1e40af","#a5b4fc"] }]
    },
    options: { plugins: { legend: { position: "bottom" } }, responsive: true }
  });
}

// ---------- Summarization (local-only OpenAI + fallback) ----------
const OPENAI_API_KEY_LOCAL = "sk-REPLACE_WITH_YOUR_KEY"; // put your key for local demos
const IS_LOCALHOST = ["localhost","127.0.0.1"].includes(location.hostname);
const OPENAI_API_KEY = IS_LOCALHOST ? OPENAI_API_KEY_LOCAL : "";

async function smartSummarize(text) {
  if (OPENAI_API_KEY && OPENAI_API_KEY !== "sk-REPLACE_WITH_YOUR_KEY") {
    const res = await summarizeWithOpenAI(text);
    if (!res || /failed|error/i.test(res)) return offlineSummarize(text);
    return res;
  }
  return offlineSummarize(text);
}

function offlineSummarize(text) {
  const clean = text.replace(/\s+/g," ").trim();
  const firstPeriod = clean.indexOf(". ");
  if (firstPeriod > 40) return clean.slice(0, firstPeriod + 1);
  return clean.length > 180 ? clean.slice(0, 180) + "..." : clean;
}

async function summarizeWithOpenAI(text) {
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Summarize this GitHub issue in 1–2 concise sentences for a beginner contributor." },
          { role: "user", content: text }
        ],
        temperature: 0.4,
        max_tokens: 80
      })
    });
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || "No summary.";
  } catch (e) {
    console.error(e);
    return "AI summary failed.";
  }
}

// Panel buttons
if (summarizeFreeBtn) {
  summarizeFreeBtn.addEventListener("click", () => {
    const txt = summaryInput.value.trim();
    if (!txt) return alert("Paste some issue text first.");
    summaryOutput.innerHTML = `<strong>Summary:</strong> ${escapeHtml(offlineSummarize(txt))}`;
  });
}
if (summarizeOpenAIBtn) {
  summarizeOpenAIBtn.addEventListener("click", async () => {
    const txt = summaryInput.value.trim();
    if (!txt) return alert("Paste some issue text first.");
    summaryOutput.textContent = "Summarizing...";
    const s = await smartSummarize(txt);
    summaryOutput.innerHTML = `<strong>Summary:</strong> ${escapeHtml(s)}`;
  });
}

// ---------- Utils ----------
function escapeHtml(str){
  return str.replaceAll("&","&amp;")
            .replaceAll("<","&lt;")
            .replaceAll(">","&gt;")
            .replaceAll('"',"&quot;")
            .replaceAll("'","&#039;");
}
function showToast(msg){
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"), 1600);
}

// ---------- Init ----------
window.addEventListener("DOMContentLoaded", () => {
  renderIssues(bookmarks, bookmarksDiv);
  updateBookmarkCount();
  renderBookmarkPieByLanguage();
});
