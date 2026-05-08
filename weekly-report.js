const fs = require("fs");

const posts = require("./raw-posts.json");

// ── Date range: Nov 1 2025 – Apr 30 2026 ─────────────────────────────────────
const START = new Date("2025-11-01T00:00:00Z");
const END   = new Date("2026-04-30T23:59:59Z");

// ── Build weekly buckets (Mon–Sun) ────────────────────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Generate all week-start Mondays in range
const weeks = [];
let cursor = getWeekStart(START);
while (cursor <= END) {
  weeks.push(new Date(cursor));
  cursor = new Date(cursor);
  cursor.setUTCDate(cursor.getUTCDate() + 7);
}

// Week label: "Nov W1" style
function weekLabel(date) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  const wk = Math.ceil(day / 7);
  return `${months[m]} W${wk}`;
}

const weekLabels = weeks.map(w => weekLabel(w));

// ── All unique accounts ───────────────────────────────────────────────────────
const accounts = [...new Set(posts.map(p => p._account))].sort();

// ── Aggregate ─────────────────────────────────────────────────────────────────
// data[account][weekIndex] = { posts, likes, views }
const data = {};
for (const acc of accounts) {
  data[acc] = weeks.map(() => ({ posts: 0, likes: 0, views: 0 }));
}

for (const post of posts) {
  const ts = new Date(post.timestamp);
  if (ts < START || ts > END) continue;

  const ws = getWeekStart(ts);
  const idx = weeks.findIndex(w => w.getTime() === ws.getTime());
  if (idx === -1) continue;

  const acc = post._account;
  if (!data[acc]) continue;

  data[acc][idx].posts += 1;
  data[acc][idx].likes += post.likesCount || 0;
  data[acc][idx].views += post.videoViewCount || post.videoPlayCount || 0;
}

// ── Write CSV helper ──────────────────────────────────────────────────────────
function writeCSV(filename, metric) {
  const header = ["account", ...weekLabels].join(",");
  const rows = accounts.map(acc => {
    const values = data[acc].map(w => w[metric]);
    return [acc, ...values].join(",");
  });
  fs.writeFileSync(filename, [header, ...rows].join("\n"));
  console.log(`✅  Saved ${filename}`);
}

writeCSV("weekly-posts.csv",  "posts");
writeCSV("weekly-views.csv",  "views");
writeCSV("weekly-likes.csv",  "likes");

// ── Print quick preview ───────────────────────────────────────────────────────
console.log(`\n📅  Weeks covered: ${weekLabels[0]} → ${weekLabels[weekLabels.length - 1]} (${weeks.length} weeks)`);
console.log(`👤  Accounts: ${accounts.length}`);
console.log(`📦  Total posts in range: ${posts.filter(p => new Date(p.timestamp) >= START && new Date(p.timestamp) <= END).length}`);
