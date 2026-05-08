const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Logo (embedded as base64 for self-contained HTML) ─────────────────────────
const LOGO_B64 = fs.readFileSync(path.join(__dirname, 'mitsubishi-motors-logo-png-2.png')).toString('base64');
const LOGO_SRC = 'data:image/png;base64,' + LOGO_B64;

// ── Load & filter ─────────────────────────────────────────────────────────────
const raw   = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-posts.json'), 'utf8'));
// Data window: Jul 2025 – May 2026 (first period where all 22 accounts have complete data).
const START = new Date('2025-07-01T00:00:00Z');
const END   = new Date('2026-05-31T23:59:59Z');
const posts = raw.filter(p => { const t = new Date(p.timestamp); return t >= START && t <= END; });
console.log(`Loaded ${posts.length} posts (Jul 2025 – May 2026) from ${raw.length} total`);

// ── Time axis helpers ─────────────────────────────────────────────────────────
function buildMonths() {
  const months = [];
  let d = new Date(2025, 6, 1); // Jul 2025
  const end = new Date(2026, 4, 31); // May 2026
  while (d <= end) {
    const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    months.push({ label, year: d.getFullYear(), month: d.getMonth() });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return months;
}

function buildWeeks() {
  const weeks = [];
  // First Monday >= Jul 1 2025
  let d = new Date('2025-07-01');
  const dow = d.getDay();
  const toMon = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  d = new Date(d.getTime() + toMon * 86400000);
  const end = new Date('2026-05-31');
  while (d <= end) {
    weeks.push({ label: d.toISOString().slice(0, 10), date: new Date(d) });
    d = new Date(d.getTime() + 7 * 86400000);
  }
  return weeks;
}

const ALL_MONTHS = buildMonths();
const ALL_WEEKS  = buildWeeks();

function monthKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() * 100 + d.getMonth();
}

function weekKey(ts) {
  const d = new Date(ts);
  const dow = d.getDay();
  const diff = (dow === 0 ? -6 : 1 - dow);
  const mon = new Date(d.getTime() + diff * 86400000);
  return mon.toISOString().slice(0, 10);
}

// ── Per-account buckets ───────────────────────────────────────────────────────
const accounts = [...new Set(posts.map(p => p._account))].sort();
const NOW = new Date();

function processAccount(name) {
  const acctPosts = posts.filter(p => p._account === name);

  // monthly buckets
  const mBuckets = {};
  ALL_MONTHS.forEach(m => { mBuckets[m.year * 100 + m.month] = { posts: 0, likes: 0, views: 0 }; });

  // weekly buckets
  const wBuckets = {};
  ALL_WEEKS.forEach(w => { wBuckets[w.label] = { posts: 0, likes: 0, views: 0 }; });

  let lastPosted = null;

  acctPosts.forEach(p => {
    const ts    = p.timestamp;
    const likes = p.likesCount   || 0;
    const views = p.videoViewCount || 0;
    const mk    = monthKey(ts);
    const wk    = weekKey(ts);

    if (mBuckets[mk]) { mBuckets[mk].posts++; mBuckets[mk].likes += likes; mBuckets[mk].views += views; }
    if (wBuckets[wk]) { wBuckets[wk].posts++; wBuckets[wk].likes += likes; wBuckets[wk].views += views; }

    const t = new Date(ts);
    if (!lastPosted || t > lastPosted) lastPosted = t;
  });

  // consistency = posts / weeks active (weeks where account existed, i.e. from first post week)
  const firstPost = acctPosts.reduce((min, p) => {
    const t = new Date(p.timestamp);
    return (!min || t < min) ? t : min;
  }, null);

  let weeksSpanned = 0;
  if (firstPost) {
    const firstWk = weekKey(firstPost.toISOString());
    let counting = false;
    ALL_WEEKS.forEach(w => { if (w.label === firstWk) counting = true; if (counting) weeksSpanned++; });
  }
  const consistency = weeksSpanned > 0 ? acctPosts.length / weeksSpanned : 0;

  // top 10 posts by likes + views
  const topPosts = [...acctPosts]
    .sort((a, b) => (b.likesCount + (b.videoViewCount||0)) - (a.likesCount + (a.videoViewCount||0)))
    .slice(0, 10)
    .map(p => ({
      url:        p.url,
      displayUrl: p.displayUrl,
      caption:    (p.caption || '').slice(0, 120),
      type:       p.type,
      date:       p.timestamp.slice(0, 10),
      likes:      p.likesCount   || 0,
      views:      p.videoViewCount || 0,
    }));

  const daysSince = lastPosted ? Math.floor((NOW - lastPosted) / 86400000) : 999;

  // Display name from most recent post's ownerFullName
  const displayName = (() => {
    const p = [...acctPosts].sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp)).find(p => p.ownerFullName);
    return p ? p.ownerFullName : name;
  })();

  // Initials from displayName
  const initials = (() => {
    const words = displayName.split(/[\s_.-]+/).filter(Boolean);
    return ((words[0]?.[0] || '') + (words[1]?.[0] || words[0]?.[1] || '')).toUpperCase().slice(0,2) || '??';
  })();

  return {
    name,
    displayName,
    initials,
    igUrl:       `https://www.instagram.com/${name}/`,
    profilePic:  `https://unavatar.io/instagram/${name}`,
    posts:       acctPosts.length,
    lastPosted:  lastPosted ? lastPosted.toISOString().slice(0, 10) : null,
    daysSince,
    consistency: +consistency.toFixed(2),
    topPosts,
    monthly: ALL_MONTHS.map(m => mBuckets[m.year * 100 + m.month]),
    weekly:  ALL_WEEKS.map(w  => wBuckets[w.label]),
  };
}

const accountData = accounts.map(processAccount);

// ── Content type stats ────────────────────────────────────────────────────────
function contentTypeStats() {
  const types = ['Video', 'Image', 'Sidecar'];
  return types.map(t => {
    const tp = posts.filter(p => p.type === t);
    const count = tp.length;
    const likes = tp.reduce((s, p) => s + (p.likesCount || 0), 0);
    const views = tp.reduce((s, p) => s + (p.videoViewCount || 0), 0);
    return {
      type:      t,
      count,
      avgLikes:  count > 0 ? +(likes / count).toFixed(1) : 0,
      avgViews:  count > 0 ? +(views / count).toFixed(1) : 0,
      avgEng:    count > 0 ? +((likes + views) / count).toFixed(1) : 0,
    };
  });
}

// ── Global viral top 20 ───────────────────────────────────────────────────────
const viral = [...posts]
  .sort((a, b) => (b.likesCount + (b.videoViewCount||0)) - (a.likesCount + (a.videoViewCount||0)))
  .slice(0, 20)
  .map(p => ({
    account:    p._account,
    url:        p.url,
    displayUrl: p.displayUrl,
    caption:    (p.caption || '').slice(0, 120),
    type:       p.type,
    date:       p.timestamp.slice(0, 10),
    likes:      p.likesCount    || 0,
    views:      p.videoViewCount || 0,
    timestamp:  p.timestamp,
  }));

// ── Auto-insights ─────────────────────────────────────────────────────────────
function computeInsights() {
  const insights = [];

  // Dormant
  const dormant = accountData.filter(a => a.daysSince > 14 && a.posts > 0);
  if (dormant.length > 0) {
    insights.push({
      type: 'dormant',
      color: 'red',
      icon: '🔴',
      text: `<strong>${dormant.length} account${dormant.length > 1 ? 's' : ''} dormant</strong> (no post in 14d): ${dormant.slice(0,2).map(a=>`<strong>@${a.name}</strong>`).join(', ')}${dormant.length > 2 ? ` <span style="color:#888">+${dormant.length-2} more</span>` : ''}`,
    });
  }

  // Rising / Declining — compare last full month vs prior month (cap at 2 each)
  const lastMIdx  = ALL_MONTHS.length - 2;
  const prevMIdx  = lastMIdx - 1;
  const changers  = [];
  accountData.forEach(a => {
    const curr = a.monthly[lastMIdx];
    const prev = a.monthly[prevMIdx];
    if (!curr || !prev || prev.posts === 0 || curr.posts === 0) return;
    const currEng = (curr.likes + curr.views) / curr.posts;
    const prevEng = (prev.likes + prev.views) / prev.posts;
    if (prevEng === 0) return;
    const change = (currEng - prevEng) / prevEng * 100;
    if (Math.abs(change) > 20) changers.push({ name: a.name, change });
  });
  changers.sort((a,b) => b.change - a.change);
  const rising   = changers.filter(c => c.change > 0).slice(0, 2);
  const declining = changers.filter(c => c.change < 0).slice(-2).reverse();
  rising.forEach(c => insights.push({ type:'rising',   color:'gold',   icon:'📈', text:`<strong>Rising:</strong> @${c.name} engagement up <strong>+${c.change.toFixed(0)}%</strong> vs prior month` }));
  declining.forEach(c => insights.push({ type:'declining',color:'orange', icon:'📉', text:`<strong>Declining:</strong> @${c.name} engagement down <strong>${c.change.toFixed(0)}%</strong> vs prior month` }));

  // Content insight: Video vs Image eng rate ratio
  const ctStats = contentTypeStats();
  const vid = ctStats.find(c => c.type === 'Video');
  const img = ctStats.find(c => c.type === 'Image');
  if (vid && img && img.avgEng > 0) {
    const ratio = (vid.avgEng / img.avgEng).toFixed(1);
    insights.push({ type:'content', color:'dark', icon:'🎬', text:`<strong>Content insight:</strong> Video posts get <strong>${ratio}×</strong> more engagement than Images on average` });
  }

  // Top performer: highest avg eng in last full month
  const top = accountData
    .filter(a => a.monthly[lastMIdx] && a.monthly[lastMIdx].posts > 0)
    .map(a => {
      const m = a.monthly[lastMIdx];
      return { name: a.name, eng: (m.likes + m.views) / m.posts };
    })
    .sort((a, b) => b.eng - a.eng)[0];
  if (top) {
    insights.push({ type:'top', color:'yellow', icon:'⭐', text:`<strong>Top performer</strong> (${ALL_MONTHS[lastMIdx].label}): @${top.name} — avg <strong>${Math.round(top.eng).toLocaleString()} engagement/post</strong>` });
  }

  return insights;
}

// ── Profile picture fetching ──────────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Instagram 219.0.0.12.117 Android (29/10; 420dpi; 1080x2154; samsung; SM-G988B; y2q; exynos990; en_US; 302733750)',
        ...headers,
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location, headers));
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), type: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchProfilePic(name, ownerId) {
  try {
    const info = await httpGet(`https://i.instagram.com/api/v1/users/${ownerId}/info/`);
    if (info.status === 401 || info.status === 429) {
      process.stdout.write(`rate limited (${info.status})\n`);
      return { rateLimited: true };
    }
    if (info.status !== 200) throw new Error(`HTTP ${info.status}`);
    const json = JSON.parse(info.body.toString());
    const picUrl = json.user?.profile_pic_url_hd || json.user?.profile_pic_url;
    if (!picUrl) throw new Error('no pic url');

    const img = await httpGet(picUrl);
    if (img.status !== 200) throw new Error(`img HTTP ${img.status}`);
    const mime = img.type.split(';')[0] || 'image/jpeg';
    return `data:${mime};base64,` + img.body.toString('base64');
  } catch (e) {
    process.stdout.write(`⚠ ${e.message}\n`);
    return null;
  }
}

const CACHE_FILE = path.join(__dirname, 'profile-pics-cache.json');

async function fetchAllProfilePics() {
  // Load persistent cache (base64 data URLs keyed by account name)
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
  }

  // Build ownerId map from raw posts
  const ownerMap = {};
  raw.forEach(p => { if (p._account && p.ownerId && !ownerMap[p._account]) ownerMap[p._account] = p.ownerId; });

  const missing = accountData.filter(a => !cache[a.name]);
  if (missing.length === 0) {
    console.log('Profile pictures: all 22 loaded from cache ✓');
    return cache;
  }

  console.log(`Profile pictures: ${accountData.length - missing.length} from cache, fetching ${missing.length} new…`);
  let rateLimited = false;
  for (const a of missing) {
    if (rateLimited) { console.log(`  skip ${a.name} (rate limited)`); continue; }
    const oid = ownerMap[a.name];
    if (!oid) { console.log(`  ⚠ ${a.name}: no ownerId`); continue; }
    process.stdout.write(`  ${a.name}… `);
    const result = await fetchProfilePic(a.name, oid);
    if (result && typeof result === 'string') {
      cache[a.name] = result;
      process.stdout.write('✓\n');
    } else if (result && result.rateLimited) {
      rateLimited = true;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Save updated cache (only if we fetched something new)
  const cached = accountData.filter(a => cache[a.name]).length;
  if (cached > 0) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  if (rateLimited) console.log('  ⚠ Rate limited by Instagram — retry later. Using cached pics where available.');
  return cache;
}

// ── Assemble __DATA__ (async so we can embed profile pics) ────────────────────
async function buildAndWrite() {
  const profilePics = await fetchAllProfilePics();

  // Inject real profile pic (base64) or null into each account
  const accountsWithPics = accountData.map(a => ({
    ...a,
    profilePic: profilePics[a.name] || null,
  }));

  const DATA = {
    accounts:     accountsWithPics,
    months:       ALL_MONTHS.map(m => m.label),
    weeks:        ALL_WEEKS.map(w => w.label),
    viral,
    contentTypes: contentTypeStats(),
    insights:     computeInsights(),
    generatedAt:  NOW.toISOString(),
    totalPosts:   posts.length,
  };

// ── Dashboard HTML template ───────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mitsubishi Motors Dealer Dashboard</title>
<link rel="icon" type="image/png" href="${LOGO_SRC}">
<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
<style>
/* ── Reset & Base ─────────────────────────────────────────────────────────── */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; background: #f7f7f7; color: #1e2939; font-size: 14px; }

/* ── Header — Dark with diagonal red accent (brand signature) ─────────────── */
.header {
  background: #111010;
  color: white;
  position: relative;
  overflow: hidden;
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 1;
}
/* Diagonal red panel — brand signature clip-path element */
.header::before {
  content: '';
  position: absolute;
  right: 0; top: 0;
  width: 320px; height: 100%;
  background: #ED0000;
  clip-path: polygon(28% 0, 100% 0, 100% 100%, 0% 100%);
  z-index: 0;
}
.header-left  { display: flex; align-items: center; gap: 16px; position: relative; z-index: 1; }
.header-right { text-align: right; position: relative; z-index: 1; }
/* Logo: white container for brand-guideline contrast compliance on dark bg */
.mmk-logo-wrap { background: white; padding: 7px 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.mmk-logo-img  { height: 44px; width: auto; display: block; }
.header-brand h1 {
  font-size: 15px; font-weight: 700; letter-spacing: 1.5px;
  text-transform: uppercase; line-height: 1.2;
}
.header-brand .subtitle { font-size: 11px; opacity: 0.7; margin-top: 3px; letter-spacing: 0.3px; }
.header-tagline { font-size: 12px; font-style: italic; font-weight: 600; letter-spacing: 0.5px; opacity: 0.9; }
.header-gen   { font-size: 10px; opacity: 0.55; margin-top: 4px; }

/* ── Filter bar ───────────────────────────────────────────────────────────── */
.filter-bar {
  background: white;
  border-bottom: 2px solid #111010;
  padding: 10px 24px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  position: sticky; top: 0; z-index: 100;
}
.filter-label { font-size: 10px; color: #6a7282; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
.btn-group { display: flex; gap: 4px; }
.btn {
  padding: 5px 12px; border-radius: 2px; border: 1px solid #bfc2c4;
  background: white; cursor: pointer; font-size: 10px; color: #364153;
  text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;
  transition: all 0.12s; font-family: Arial, sans-serif;
}
.btn:hover  { background: #bd0000; color: white; border-color: #bd0000; }
.btn.active { background: #ED0000; color: white; border-color: #ED0000; }
.divider    { width: 1px; height: 24px; background: #bfc2c4; }
.date-input { padding: 5px 8px; border: 1px solid #bfc2c4; border-radius: 2px; font-size: 11px; color: #1e2939; font-family: Arial, sans-serif; }
.range-badge {
  font-size: 10px; background: #111010; color: white;
  border-radius: 2px; padding: 3px 10px; font-weight: 700;
  letter-spacing: 0.5px; text-transform: uppercase; white-space: nowrap;
}

/* ── Main layout ──────────────────────────────────────────────────────────── */
.main { padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; }

/* ── KPI Cards — red top-accent ──────────────────────────────────────────── */
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.kpi-card {
  background: white; border-radius: 2px; padding: 18px 20px;
  border: 1px solid #e3e5e6; border-top: 3px solid #ED0000;
  position: relative;
}
.kpi-card.danger { border-top-color: #111010; }
.kpi-label { font-size: 10px; font-weight: 700; color: #6a7282; text-transform: uppercase; letter-spacing: 0.8px; }
.kpi-value { font-size: 28px; font-weight: 700; color: #1e2939; margin: 6px 0 2px; }
.kpi-sub { font-size: 11px; color: #6a7282; }
.kpi-card.danger .kpi-value { color: #ED0000; }
.delta-up   { font-size: 11px; font-weight: 700; margin-top: 5px; color: #4a5565; }
.delta-up::before { content: '▲ '; color: #ED0000; }
.delta-down { font-size: 11px; font-weight: 700; margin-top: 5px; color: #6a7282; }
.delta-down::before { content: '▼ '; color: #686d71; }

/* ── Cards & Section titles ───────────────────────────────────────────────── */
.card { background: white; border-radius: 2px; border: 1px solid #e3e5e6; overflow: hidden; }
.card-header {
  padding: 12px 20px; border-bottom: 1px solid #e3e5e6;
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  border-left: 3px solid #ED0000;
}
.section-title {
  font-size: 12px; font-weight: 700; color: #1e2939;
  text-transform: uppercase; letter-spacing: 0.8px;
  display: flex; align-items: center; gap: 8px;
}
.section-title .st-accent { color: #ED0000; font-size: 10px; }
.sort-hint { font-size: 10px; color: #6a7282; letter-spacing: 0.3px; }

/* ── Table ────────────────────────────────────────────────────────────────── */
table { width: 100%; border-collapse: collapse; }
th {
  padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700;
  color: #686d71; text-transform: uppercase; letter-spacing: 0.6px;
  background: #f7f7f7; border-bottom: 1px solid #e3e5e6;
  cursor: pointer; user-select: none; white-space: nowrap;
}
th:hover { color: #ED0000; }
th.sorted { color: #ED0000; }
td { padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
tr:last-child td { border-bottom: none; }
/* Top 5 — Yellow Gold tint (brand accent for awards) */
tr.top-row td    { background: #fffde7; }
/* Bottom 5 — neutral Concrete Grey tint */
tr.bottom-row td { background: #f9fafb; }
/* Dormant — warm alert using brand red tint */
tr.dormant-row td { background: #fff0f0; }
tr.account-row { cursor: pointer; transition: background 0.1s; }
tr.account-row:hover td { background: #f3f4f6 !important; }

/* ── Badges ───────────────────────────────────────────────────────────────── */
.badge { display: inline-block; padding: 2px 8px; border-radius: 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; }
.badge.gold   { background: #fac800; color: #111010; }
.badge.red    { background: #ED0000; color: white; }
.badge.orange { background: #fef3c7; color: #7b341e; border: 1px solid #fac800; }
.badge.gray   { background: #e3e5e6; color: #364153; }

/* ── Consistency bar ──────────────────────────────────────────────────────── */
.consistency-bar { display: flex; align-items: center; gap: 6px; }
.bar-track { width: 48px; height: 5px; background: #e3e5e6; border-radius: 0; overflow: hidden; }
.bar-fill  { height: 100%; background: #ED0000; }

/* ── Insights panel ───────────────────────────────────────────────────────── */
.insights { background: white; border-radius: 2px; border: 1px solid #e3e5e6; border-left: 3px solid #ED0000; padding: 14px 20px; }
.insights-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; }
.insight-count-badge {
  display: inline-block; background: #ED0000; color: white;
  border-radius: 2px; padding: 1px 7px; font-size: 10px; font-weight: 700;
  letter-spacing: 0.5px; margin-left: 8px;
}
.insights-toggle { font-size: 11px; color: #6a7282; transition: transform 0.2s; display: inline-block; }
.insights-toggle.open { transform: rotate(180deg); }
.insight-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.insight-item { display: flex; align-items: flex-start; gap: 10px; padding: 9px 12px; font-size: 13px; line-height: 1.5; }
/* Brand-aligned insight colors — no non-palette greens or blues */
.insight-item.red      { background: #fff0f0; border-left: 3px solid #ED0000; }
.insight-item.gold     { background: #fffde7; border-left: 3px solid #fac800; }
.insight-item.orange   { background: #fff9ed; border-left: 3px solid #686d71; }
.insight-item.dark     { background: #f7f7f7; border-left: 3px solid #111010; }
.insight-item.yellow   { background: #fffde7; border-left: 3px solid #fac800; }
.insight-icon { font-size: 14px; flex-shrink: 0; margin-top: 2px; }

/* ── Performance Matrix ───────────────────────────────────────────────────── */
.matrix-wrap { overflow-x: auto; }
.matrix-table { min-width: 600px; border-collapse: separate; border-spacing: 0; }
.matrix-table th, .matrix-table td { padding: 7px 9px; white-space: nowrap; font-size: 11px; }
.matrix-table .sticky-col {
  position: sticky; left: 0; z-index: 2; background: white;
  min-width: 150px; max-width: 150px; width: 150px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  box-shadow: 2px 0 4px rgba(0,0,0,0.06); border-right: 1px solid #e3e5e6;
}
.matrix-table thead .sticky-col { background: #f7f7f7; z-index: 3; }
.matrix-table tr.pinned .sticky-col { background: #fff0f0; }
.cell { text-align: center; font-weight: 600; font-size: 11px; }
.matrix-table tr.pinned td { background: #fff0f0 !important; }
.pin-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }

/* ── Trend chart ──────────────────────────────────────────────────────────── */
.chart-wrap { padding: 16px 20px; }
.pinned-strip { padding: 10px 20px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 38px; }
.pinned-pill {
  display: flex; align-items: center; gap: 5px; padding: 3px 10px;
  border-radius: 2px; font-size: 10px; font-weight: 700;
  border: 1.5px solid; cursor: pointer; text-transform: uppercase; letter-spacing: 0.4px;
}
.pinned-pill:hover { opacity: 0.75; }
.pinned-empty { font-size: 11px; color: #686d71; font-style: italic; }

/* ── Viral posts ──────────────────────────────────────────────────────────── */
.viral-thumb { width: 48px; height: 48px; object-fit: cover; display: block; background: #e3e5e6; }
.viral-thumb-placeholder { width: 48px; height: 48px; background: linear-gradient(135deg, #e3e5e6, #bfc2c4); display: flex; align-items: center; justify-content: center; font-size: 18px; }
.post-link { color: #ED0000; text-decoration: none; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
.post-link:hover { color: #bd0000; text-decoration: underline; }
.caption-text { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #686d71; font-size: 12px; }

/* ── Scroll / expand helpers ──────────────────────────────────────────────── */
.scroll-wrap { overflow-y: auto; }
.scroll-wrap thead th { position: sticky; top: 0; z-index: 2; }
.matrix-wrap.scroll-wrap thead th { z-index: 4; }
.matrix-wrap.scroll-wrap thead .sticky-col { z-index: 5; }
.expand-bar { padding: 8px 20px; border-top: 1px solid #e3e5e6; background: #f9fafb; }
.expand-btn { width: 100%; background: none; border: none; cursor: pointer; font-size: 10px; font-weight: 700; color: #686d71; padding: 4px 0; text-align: center; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; }
.expand-btn:hover { color: #ED0000; }

/* ── Modal ────────────────────────────────────────────────────────────────── */
.modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(17,16,16,0.65); z-index: 1000; align-items: center; justify-content: center; padding: 20px; }
.modal-backdrop.open { display: flex; }
.modal-card { background: white; border-radius: 2px; width: 720px; max-width: 94vw; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
.modal-header { padding: 0; border-bottom: 1px solid #e3e5e6; display: flex; align-items: stretch; justify-content: space-between; flex-shrink: 0; }
.modal-header-inner { padding: 16px 20px 14px; border-left: 4px solid #ED0000; flex: 1; }
.modal-title { font-size: 15px; font-weight: 700; color: #1e2939; text-transform: uppercase; letter-spacing: 0.5px; }
.modal-subtitle { font-size: 11px; color: #6a7282; margin-top: 3px; }
.modal-close { background: #111010; border: none; font-size: 20px; cursor: pointer; color: white; line-height: 1; padding: 8px 14px; border-radius: 0; flex-shrink: 0; align-self: stretch; }
.modal-close:hover { background: #ED0000; }
.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.modal-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.modal-stat { background: #f7f7f7; border-radius: 2px; padding: 10px 14px; flex: 1; min-width: 90px; border: 1px solid #e3e5e6; border-top: 2px solid #ED0000; }
.modal-stat-label { font-size: 10px; color: #6a7282; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
.modal-stat-value { font-size: 18px; font-weight: 700; color: #1e2939; margin-top: 2px; }
.modal-posts-table { width: 100%; border-collapse: collapse; }
.modal-posts-table th { padding: 8px 10px; text-align: left; font-size: 10px; font-weight: 700; color: #686d71; text-transform: uppercase; letter-spacing: 0.5px; background: #f7f7f7; border-bottom: 1px solid #e3e5e6; }
.modal-posts-table td { padding: 8px 10px; border-bottom: 1px solid #f3f4f6; font-size: 12px; vertical-align: middle; }
.modal-posts-table tr:last-child td { border-bottom: none; }
.modal-thumb { width: 42px; height: 42px; object-fit: cover; display: block; background: #e3e5e6; }
.modal-thumb-placeholder { width: 42px; height: 42px; background: linear-gradient(135deg,#e3e5e6,#bfc2c4); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }

/* ── Account avatars ──────────────────────────────────────────────────────── */
.acct-cell { display: flex; align-items: center; gap: 9px; }
.av { border-radius: 50%; object-fit: cover; flex-shrink: 0; display: block; background: #e3e5e6; }
.av-32 { width: 32px; height: 32px; }
.av-24 { width: 24px; height: 24px; }
.av-56 { width: 56px; height: 56px; }
.av-wrap { position: relative; flex-shrink: 0; }
.av-wrap .av-ig { position: absolute; bottom: -2px; right: -2px; width: 14px; height: 14px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23ED0000'/%3E%3Ccircle cx='12' cy='12' r='4.5' stroke='white' stroke-width='2' fill='none'/%3E%3Ccircle cx='17' cy='7' r='1.3' fill='white'/%3E%3C/svg%3E") center/cover no-repeat; border-radius: 3px; }
.av-56 ~ .av-ig { width: 18px; height: 18px; }
.acct-name-link { color: #1e2939; text-decoration: none; font-weight: 700; }
.acct-name-link:hover { color: #ED0000; text-decoration: underline; }
.acct-display { font-size: 10px; color: #686d71; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }

@media (max-width: 900px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .header::before { width: 160px; }
}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="mmk-logo-wrap">
      <img class="mmk-logo-img" src="${LOGO_SRC}" alt="Mitsubishi Motors">
    </div>
    <div class="header-brand">
      <h1>Mitsubishi Motors Dealer Dashboard</h1>
      <div class="subtitle">Instagram Performance · 22 Accounts · Jul 2025 – May 2026 · ${posts.length.toLocaleString()} posts</div>
    </div>
  </div>
  <div class="header-right">
    <div class="header-tagline">"Drive Your Ambition"</div>
    <div class="header-gen">Generated: ${NOW.toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' })}</div>
  </div>
</div>

<div class="filter-bar">
  <span class="filter-label">Range</span>
  <div class="btn-group" id="rangeGroup">
    <button class="btn" onclick="setRange(this,'7d')">Last 7D</button>
    <button class="btn" onclick="setRange(this,'30d')">Last 30D</button>
    <button class="btn" onclick="setRange(this,'3m')">Last 3M</button>
    <button class="btn" onclick="setRange(this,'6m')">Last 6M</button>
    <button class="btn active" onclick="setRange(this,'all')">All</button>
  </div>
  <div class="divider"></div>
  <span class="filter-label">Custom</span>
  <input type="date" class="date-input" id="dateFrom" value="2025-07-01" onchange="if(!_syncingPickers) setRange(null,'custom')">
  <span style="color:#6a7282;font-size:12px;">→</span>
  <input type="date" class="date-input" id="dateTo" value="${NOW.toISOString().slice(0,10)}" onchange="if(!_syncingPickers) setRange(null,'custom')">
  <div class="divider"></div>
  <span class="filter-label">View</span>
  <div class="btn-group" id="granGroup">
    <button class="btn active" onclick="setGran(this,'monthly')">Monthly</button>
    <button class="btn" onclick="setGran(this,'weekly')">Weekly</button>
  </div>
  <span class="range-badge" id="rangeBadge">All · 11 months</span>
</div>

<div class="main">

  <div class="kpi-grid" id="kpiGrid"></div>

  <div class="insights">
    <div class="insights-header" onclick="toggleInsights()">
      <div class="section-title" style="margin:0;">
        <span class="st-accent">◆</span> Auto Insights
        <span class="insight-count-badge" id="insightCount">0</span>
        <span style="font-size:10px;font-weight:400;color:#686d71;margin-left:4px;" id="insightRange"></span>
      </div>
      <span class="insights-toggle" id="insightToggle">▼</span>
    </div>
    <div class="insight-list" id="insightList" style="display:none;"></div>
  </div>

  <div class="card">
    <div class="card-header">
      <div class="section-title"><span class="st-accent">◆</span> Account Rankings</div>
      <div class="sort-hint">Click column to sort &nbsp;·&nbsp; Click row for drill-down</div>
    </div>
    <div id="rankScroll" class="scroll-wrap" style="max-height:320px;">
      <table id="rankTable">
        <thead>
          <tr>
            <th onclick="sortRank('#')">#</th>
            <th>Account</th>
            <th onclick="sortRank('posts')">Posts ↕</th>
            <th onclick="sortRank('avgLikes')">Avg Likes/Post ↕</th>
            <th onclick="sortRank('avgViews')">Avg Views/Post ↕</th>
            <th onclick="sortRank('consistency')">Consistency</th>
            <th onclick="sortRank('daysSince')">Last Posted</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="rankBody"></tbody>
      </table>
    </div>
    <div class="expand-bar">
      <button class="expand-btn" id="rankToggleBtn" onclick="toggleRankings()">▼ Show all 22 accounts</button>
    </div>
  </div>

  <div class="card" id="trendSection">
    <div class="card-header">
      <div class="section-title">
        <span class="st-accent">◆</span> Trend Chart
        <span style="font-size:10px;font-weight:400;color:#686d71;" id="trendModeLabel">· All accounts total</span>
      </div>
      <div class="btn-group" id="trendMetricGroup">
        <button class="btn active" onclick="setTrendMetric(this,'posts')">Posts</button>
        <button class="btn" onclick="setTrendMetric(this,'likes')">Likes</button>
        <button class="btn" onclick="setTrendMetric(this,'views')">Views</button>
        <button class="btn" onclick="setTrendMetric(this,'eng')">Eng Rate</button>
      </div>
    </div>
    <div id="pinnedStrip" class="pinned-strip"></div>
    <div class="chart-wrap">
      <canvas id="trendChart" height="90"></canvas>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <div class="section-title">
        <span class="st-accent">◆</span> Performance Matrix
        <span style="font-size:10px;font-weight:400;color:#686d71;">· Click row to pin in trend chart</span>
      </div>
      <div class="btn-group" id="matrixMetricGroup">
        <button class="btn active" onclick="setMatrixMetric(this,'posts')">Posts</button>
        <button class="btn" onclick="setMatrixMetric(this,'likes')">Likes</button>
        <button class="btn" onclick="setMatrixMetric(this,'views')">Views</button>
      </div>
    </div>
    <div class="matrix-wrap scroll-wrap" id="matrixScroll" style="max-height:360px;">
      <table class="matrix-table">
        <thead id="matrixHead"></thead>
        <tbody id="matrixBody"></tbody>
      </table>
    </div>
    <div class="expand-bar">
      <button class="expand-btn" id="matrixToggleBtn" onclick="toggleMatrix()">▼ Show all 22 accounts</button>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <div class="section-title"><span class="st-accent">◆</span> Top Viral Posts</div>
      <div class="sort-hint" id="viralHint">Top 20 by likes + views</div>
    </div>
    <div class="scroll-wrap" style="max-height:480px;">
      <table class="viral-table">
        <thead>
          <tr>
            <th style="width:56px;"></th>
            <th>Account</th>
            <th>Date</th>
            <th>Type</th>
            <th>Likes</th>
            <th>Views</th>
            <th>Caption</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="viralBody"></tbody>
      </table>
    </div>
  </div>

</div>

<div class="modal-backdrop" id="drillModal" onclick="handleModalClick(event)">
  <div class="modal-card" id="drillCard">
    <div class="modal-header">
      <div class="modal-header-inner">
        <div class="modal-title" id="modalTitle">@account</div>
        <div class="modal-subtitle" id="modalSubtitle"></div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" id="modalBody"></div>
  </div>
</div>

<script>
window.__DATA__ = ${JSON.stringify(DATA)};

const D = window.__DATA__;
const COLORS = ['#ED0000','#2563eb','#16a34a','#d97706','#7c3aed','#0891b2','#be185d','#065f46','#b45309','#1e40af'];
const typeIcon = { Video:'🎬', Image:'📷', Sidecar:'🖼️' };

// ── Avatar helpers ────────────────────────────────────────────────────────────
function avatarSvg(init, size) {
  const s = size || 32;
  const fs = Math.round(s * 0.36);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+s+'" height="'+s+'"><rect width="'+s+'" height="'+s+'" rx="'+s+'" fill="#ED0000"/><text x="'+Math.round(s/2)+'" y="'+Math.round(s*0.64)+'" text-anchor="middle" font-family="Arial" font-size="'+fs+'" font-weight="700" fill="white">'+init+'</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function avatarImg(profilePic, initials, sizeCls, size) {
  const sz = size || 32;
  // If profilePic is a base64 data URL (embedded at build time), use directly with no onerror needed
  // If null, render the SVG initials immediately
  const src = profilePic || avatarSvg(initials, sz);
  const err = profilePic ? ' onerror="this.onerror=null;this.src=avatarSvg(this.dataset.init,'+sz+')"' : '';
  return '<img class="av '+sizeCls+'" src="'+src+'" loading="lazy"'+err+' data-init="'+initials+'" alt="">';
}

function acctLink(name, igUrl, inner) {
  return '<a class="acct-name-link" href="'+igUrl+'" target="_blank" rel="noopener">'+inner+'</a>';
}

// State
let currentRange  = 'all';
let currentGran   = 'monthly';
let currentMatrix = 'posts';
let currentTrend  = 'posts';
let sortKey       = 'avgLikes';
let sortDir       = -1;
let pinnedAccounts  = [];
let trendChart      = null;
let insightsOpen    = false;
let rankExpanded    = false;
let matrixExpanded  = false;

// ── Time index helpers ────────────────────────────────────────────────────────
const NOW_DATE = new Date(D.generatedAt);

function getDateFrom() {
  const v = document.getElementById('dateFrom').value;
  const [y,m,dd] = v.split('-').map(Number);
  return new Date(y, m-1, dd);
}
function getDateTo() {
  const v = document.getElementById('dateTo').value;
  const [y,m,dd] = v.split('-').map(Number);
  return new Date(y, m-1, dd);
}

const DATA_START = new Date('2025-07-01');
const DATA_END   = new Date(); // today — so "Last 3M / 6M / All" always anchors to now

function getRangeWindow() {
  // All shortcuts are relative to DATA_END so they align with actual data
  const end = DATA_END;
  if (currentRange === '7d')  return { from: new Date(end - 7*86400000),   to: end };
  if (currentRange === '30d') return { from: new Date(end - 30*86400000),  to: end };
  if (currentRange === '3m')  return { from: new Date(end.getFullYear(), end.getMonth()-3, 1), to: end };
  if (currentRange === '6m')  return { from: new Date(end.getFullYear(), end.getMonth()-6, 1), to: end };
  if (currentRange === 'custom') return { from: getDateFrom(), to: getDateTo() };
  return { from: DATA_START, to: DATA_END };
}

function parseMonthLabel(label) {
  const [mon, year] = label.split(' ');
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  return new Date(+year, months[mon], 1);
}

function parseWeekLabel(label) {
  // Parse YYYY-MM-DD as local time (not UTC) to match getRangeWindow dates
  const [y,m,dd] = label.split('-').map(Number);
  return new Date(y, m-1, dd);
}

function getColIndices() {
  const { from, to } = getRangeWindow();
  const arr = currentGran === 'monthly' ? D.months : D.weeks;
  return arr.map((label, i) => {
    const d = currentGran === 'monthly' ? parseMonthLabel(label) : parseWeekLabel(label);
    return (d >= from && d <= to) ? i : -1;
  }).filter(i => i >= 0);
}

function getPrevColIndices(idx) {
  if (!idx.length || currentRange === 'all') return [];
  const shift = idx.length;
  return idx.map(i => i - shift).filter(i => i >= 0);
}

function getVisibleLabels(idx) {
  const arr = currentGran === 'monthly' ? D.months : D.weeks;
  return idx.map(i => arr[i]);
}

// ── Account totals for a set of column indices ─────────────────────────────
function acctTotals(a, idxArr) {
  const src = currentGran === 'monthly' ? a.monthly : a.weekly;
  let posts=0, likes=0, views=0;
  idxArr.forEach(i => {
    const b = src[i];
    if (b) { posts+=b.posts; likes+=b.likes; views+=b.views; }
  });
  return { posts, likes, views };
}

function globalTotals(idxArr) {
  let posts=0, likes=0, views=0;
  D.accounts.forEach(a => {
    const t = acctTotals(a, idxArr);
    posts+=t.posts; likes+=t.likes; views+=t.views;
  });
  return { posts, likes, views };
}

// ── Sorted computed rankings ──────────────────────────────────────────────────
function computedRankings(idx, cmpIdx) {
  return D.accounts.map(a => {
    const { posts, likes, views } = acctTotals(a, idx);
    const avgLikes = posts > 0 ? likes/posts : 0;
    const avgViews = posts > 0 ? views/posts : 0;
    const avgEng   = posts > 0 ? (likes+views)/posts : 0;

    let popLikes=null, popViews=null;
    if (cmpIdx.length) {
      const { posts:cp, likes:cl, views:cv } = acctTotals(a, cmpIdx);
      if (cp > 0) {
        const pl = cl/cp, pv = cv/cp;
        if (pl > 0) popLikes = (avgLikes-pl)/pl*100;
        if (pv > 0) popViews = (avgViews-pv)/pv*100;
      }
    }
    return { ...a, fPosts:posts, fLikes:likes, fViews:views, avgLikes, avgViews, avgEng, popLikes, popViews };
  });
}

// ── Filter bar ────────────────────────────────────────────────────────────────
let _syncingPickers = false;

// Format date as YYYY-MM-DD in local time (not UTC) for <input type="date">
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function setRange(btn, val) {
  currentRange = val;
  document.querySelectorAll('#rangeGroup .btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Sync date pickers to reflect the actual from/to being applied
  if (val !== 'custom') {
    _syncingPickers = true;
    const { from, to } = getRangeWindow();
    document.getElementById('dateFrom').value = localDateStr(from);
    document.getElementById('dateTo').value   = localDateStr(to);
    _syncingPickers = false;
  }

  if (rankExpanded)   toggleRankings();
  if (matrixExpanded) toggleMatrix();
  updateBadge();
  renderAll();
}

function setGran(btn, val) {
  currentGran = val;
  document.querySelectorAll('#granGroup .btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateBadge();
  renderAll();
}

function updateBadge() {
  const idx = getColIndices();
  const labels = getVisibleLabels(idx);
  const unit = currentGran === 'monthly' ? 'months' : 'weeks';
  if (!labels.length) { document.getElementById('rangeBadge').textContent = 'No data'; return; }
  document.getElementById('rangeBadge').textContent = labels[0] + ' – ' + labels[labels.length-1] + ' · ' + labels.length + ' ' + unit;
}

function toggleRankings() {
  rankExpanded = !rankExpanded;
  document.getElementById('rankScroll').style.maxHeight = rankExpanded ? 'none' : '320px';
  document.getElementById('rankToggleBtn').textContent   = rankExpanded ? '▲ Collapse' : '▼ Show all 22 accounts';
}

function toggleMatrix() {
  matrixExpanded = !matrixExpanded;
  document.getElementById('matrixScroll').style.maxHeight = matrixExpanded ? 'none' : '360px';
  document.getElementById('matrixToggleBtn').textContent   = matrixExpanded ? '▲ Collapse' : '▼ Show all 22 accounts';
}

function toggleInsights() {
  insightsOpen = !insightsOpen;
  document.getElementById('insightList').style.display  = insightsOpen ? 'flex' : 'none';
  document.getElementById('insightToggle').className    = 'insights-toggle' + (insightsOpen ? ' open' : '');
}

// ── KPI render ────────────────────────────────────────────────────────────────
function renderKPIs() {
  const idx    = getColIndices();
  const cmpIdx = getPrevColIndices(idx);
  const curr   = globalTotals(idx);
  const prev   = cmpIdx.length ? globalTotals(cmpIdx) : null;

  const dormant = D.accounts.filter(a => a.daysSince > 14).length;
  const active  = D.accounts.length - dormant;

  const periodWks = currentGran === 'monthly' ? idx.length * 4.33 : idx.length;
  const ppw  = periodWks > 0 ? (curr.posts/periodWks).toFixed(1) : '0';
  const alikes = curr.posts > 0 ? Math.round(curr.likes/curr.posts) : 0;
  const aviews = curr.posts > 0 ? Math.round(curr.views/curr.posts) : 0;

  let prevPpw=null, prevAlikes=null, prevAviews=null;
  if (prev) {
    prevPpw    = periodWks > 0 ? prev.posts/periodWks : null;
    prevAlikes = prev.posts > 0 ? prev.likes/prev.posts : null;
    prevAviews = prev.posts > 0 ? prev.views/prev.posts : null;
  }

  function deltaHtml(curr, prev) {
    if (prev === null || prev === 0) return '';
    const pct = (curr-prev)/prev*100;
    const cls = pct >= 0 ? 'delta-up' : 'delta-down';
    return '<div class="'+cls+'">'+pct.toFixed(1)+'% vs prev period</div>';
  }

  document.getElementById('kpiGrid').innerHTML =
    '<div class="kpi-card"><div class="kpi-label">Avg Posts / Week</div><div class="kpi-value">'+ppw+'</div>'+deltaHtml(parseFloat(ppw),prevPpw)+'</div>' +
    '<div class="kpi-card"><div class="kpi-label">Avg Likes / Post</div><div class="kpi-value">'+alikes.toLocaleString()+'</div>'+deltaHtml(alikes,prevAlikes)+'</div>' +
    '<div class="kpi-card"><div class="kpi-label">Avg Views / Post</div><div class="kpi-value">'+(aviews>=1000?(aviews/1000).toFixed(1)+'K':aviews)+'</div>'+deltaHtml(aviews,prevAviews)+'</div>' +
    '<div class="kpi-card'+(dormant>0?' danger':'')+'"><div class="kpi-label">Active Accounts</div><div class="kpi-value">'+active+' <span style="font-size:16px;color:#6a7282;">/ '+D.accounts.length+'</span></div><div class="kpi-sub">'+(dormant>0?dormant+' dormant (no post in 14d)':'All accounts active')+'</div></div>';
}

// ── Insights render ───────────────────────────────────────────────────────────
function renderInsights() {
  const idx = getColIndices();
  const labels = getVisibleLabels(idx);
  document.getElementById('insightRange').textContent = labels.length ? '· '+labels[0]+' – '+labels[labels.length-1] : '';
  document.getElementById('insightCount').textContent = D.insights.length;

  document.getElementById('insightList').innerHTML = D.insights.map(ins =>
    '<div class="insight-item '+ins.color+'"><span class="insight-icon">'+ins.icon+'</span><span>'+ins.text+'</span></div>'
  ).join('');
}

// ── Rankings render ───────────────────────────────────────────────────────────
function sortRank(key) {
  if (sortKey === key) sortDir *= -1;
  else { sortKey = key; sortDir = -1; }
  renderRankings();
}

function renderRankings() {
  const idx    = getColIndices();
  const cmpIdx = getPrevColIndices(idx);
  let rows = computedRankings(idx, cmpIdx);

  rows.sort((a,b) => {
    const av = a[sortKey] ?? a.daysSince;
    const bv = b[sortKey] ?? b.daysSince;
    return (av - bv) * sortDir;
  });

  const maxCons = Math.max(...D.accounts.map(a=>a.consistency), 0.01);

  document.getElementById('rankBody').innerHTML = rows.map((a,i) => {
    const isDorm = a.daysSince > 14;
    const isTop  = i < 5 && !isDorm;
    const isBtm  = i >= rows.length-5 && !isDorm;
    const rowCls = isDorm ? 'dormant-row' : isTop ? 'top-row' : isBtm ? 'bottom-row' : '';
    const badge  = isDorm ? '<span class="badge orange">Dormant</span>'
                 : isTop  ? '<span class="badge gold">Top</span>'
                 : isBtm  ? '<span class="badge gray">Low</span>' : '';
    const lastTxt = a.daysSince===0?'Today': a.daysSince===1?'Yesterday': a.daysSince>365?'Over 1yr': a.daysSince+'d ago';
    const barPct = Math.round(Math.min(a.consistency/maxCons*100, 100));
    const consWk  = a.consistency.toFixed(2);

    function popBadge(pct) {
      if (pct===null) return '';
      const up = pct >= 0;
      return '<div style="font-size:10px;font-weight:700;margin-top:2px;color:'+(up?'#4a5565':'#686d71')+';">'+(up?'▲ +':'▼ ')+pct.toFixed(1)+'%</div>';
    }

    const av32 = avatarImg(a.profilePic, a.initials, 'av-32', 32);
    return '<tr class="account-row '+rowCls+'" data-acct="'+a.name+'" onclick="openModal(this.dataset.acct)">' +
      '<td style="color:#6a7282;font-weight:700;padding-right:4px;">'+(i+1)+'</td>' +
      '<td><div class="acct-cell">'+av32+'<div>' +
        acctLink(a.name, a.igUrl, '@'+a.name) +
        '<div class="acct-display">'+a.displayName+'</div>' +
      '</div></div></td>' +
      '<td>'+a.fPosts.toLocaleString()+'</td>' +
      '<td><strong>'+Math.round(a.avgLikes).toLocaleString()+'</strong>'+popBadge(a.popLikes)+'</td>' +
      '<td>'+Math.round(a.avgViews).toLocaleString()+popBadge(a.popViews)+'</td>' +
      '<td><div class="consistency-bar"><div class="bar-track"><div class="bar-fill" style="width:'+barPct+'%"></div></div><span style="font-size:11px;color:#6a7282;">'+consWk+'/wk</span></div></td>' +
      '<td style="color:'+(a.daysSince>14?'#ED0000':'#1e2939')+'">'+lastTxt+'</td>' +
      '<td>'+badge+'</td></tr>';
  }).join('');
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(name) {
  const a    = D.accounts.find(x => x.name === name);
  const idx  = getColIndices();
  const { posts, likes, views } = acctTotals(a, idx);
  const avgL = posts>0 ? Math.round(likes/posts) : 0;
  const avgV = posts>0 ? Math.round(views/posts) : 0;
  const avgE = posts>0 ? Math.round((likes+views)/posts) : 0;

  // Modal header: avatar + name + IG link
  document.getElementById('modalTitle').innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;">' +
      '<div class="av-wrap">' +
        avatarImg(a.profilePic, a.initials, 'av-56', 56) +
        '<span class="av-ig"></span>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">' +
          acctLink(a.name, a.igUrl, '@'+a.name) +
        '</div>' +
        '<div style="font-size:11px;color:#6a7282;margin-top:3px;">'+a.displayName+'</div>' +
      '</div>' +
    '</div>';
  document.getElementById('modalSubtitle').textContent =
    (a.daysSince>14?'⚠️ Dormant — last posted '+a.daysSince+'d ago':'Active · last posted '+(a.daysSince===0?'today':a.daysSince+'d ago'));

  const rows = a.topPosts.map(p => {
    const thumb = p.displayUrl
      ? '<img class="modal-thumb" src="'+p.displayUrl+'" loading="lazy" onerror="this.style.display=\\'none\\'">'
      : '<div class="modal-thumb-placeholder">'+typeIcon[p.type]+'</div>';
    return '<tr>' +
      '<td>'+thumb+'</td>' +
      '<td style="color:#6a7282;font-size:11px;">'+p.date+'</td>' +
      '<td><span class="badge gray">'+p.type+'</span></td>' +
      '<td><strong>'+p.likes.toLocaleString()+'</strong></td>' +
      '<td>'+(p.views?p.views.toLocaleString():'–')+'</td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6a7282;font-size:11px;" title="'+p.caption.replace(/"/g,"&quot;")+'">'+p.caption+'</td>' +
      '<td><a href="'+p.url+'" target="_blank" class="post-link">View →</a></td></tr>';
  }).join('');

  document.getElementById('modalBody').innerHTML =
    '<div class="modal-stats">' +
      '<div class="modal-stat"><div class="modal-stat-label">Posts (period)</div><div class="modal-stat-value">'+posts.toLocaleString()+'</div></div>' +
      '<div class="modal-stat"><div class="modal-stat-label">Avg Likes/Post</div><div class="modal-stat-value">'+avgL.toLocaleString()+'</div></div>' +
      '<div class="modal-stat"><div class="modal-stat-label">Avg Views/Post</div><div class="modal-stat-value">'+avgV.toLocaleString()+'</div></div>' +
      '<div class="modal-stat"><div class="modal-stat-label">Avg Eng/Post</div><div class="modal-stat-value">'+avgE.toLocaleString()+'</div></div>' +
      '<div class="modal-stat"><div class="modal-stat-label">Consistency</div><div class="modal-stat-value">'+a.consistency+'/wk</div></div>' +
    '</div>' +
    '<div style="font-size:11px;color:#6a7282;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Top 10 Posts (All Time)</div>' +
    '<table class="modal-posts-table"><thead><tr><th></th><th>Date</th><th>Type</th><th>Likes</th><th>Views</th><th>Caption</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';

  document.getElementById('drillModal').classList.add('open');
}

function closeModal() { document.getElementById('drillModal').classList.remove('open'); }
function handleModalClick(e) { if (e.target.id==='drillModal') closeModal(); }

// ── Matrix ────────────────────────────────────────────────────────────────────
function setMatrixMetric(btn, val) {
  currentMatrix = val;
  document.querySelectorAll('#matrixMetricGroup .btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMatrix();
}

function cellStyle(v, rowMax) {
  if (v === 0) return 'background:#f5f5f5;color:#d1d5dc;';
  const p = v / rowMax;
  const r = Math.round(255 + (30  - 255) * p);
  const g = Math.round(255 + (64  - 255) * p);
  const b = Math.round(255 + (175 - 255) * p);
  const text = p > 0.55 ? 'white' : '#1e3a8a';
  return 'background:rgb('+r+','+g+','+b+');color:'+text+';';
}

function renderMatrix() {
  const idx  = getColIndices();
  const cols = getVisibleLabels(idx);

  document.getElementById('matrixHead').innerHTML =
    '<tr><th class="sticky-col">Account</th>'+
    cols.map(c => '<th style="text-align:center">'+c+'</th>').join('')+'</tr>';

  document.getElementById('matrixBody').innerHTML = D.accounts.map(a => {
    const src     = currentGran === 'monthly' ? a.monthly : a.weekly;
    const rowVals = idx.map(i => src[i] ? src[i][currentMatrix] : 0);
    const rowMax  = Math.max(...rowVals, 1);
    const pinIdx  = pinnedAccounts.indexOf(a.name);
    const isPinned = pinIdx !== -1;
    const color   = isPinned ? COLORS[pinIdx % COLORS.length] : null;
    const dot     = isPinned
      ? '<span class="pin-indicator" style="background:'+color+'"></span>'
      : '<span class="pin-indicator" style="background:transparent;border:1.5px solid #d1d5dc"></span>';

    const av24m = avatarImg(a.profilePic, a.initials, 'av-24', 24);
    return '<tr class="'+(isPinned?'pinned':'')+'" data-acct="'+a.name+'" onclick="togglePin(this.dataset.acct)" style="cursor:pointer;" title="'+(isPinned?'Unpin':'Pin to trend chart')+'">' +
      '<td class="sticky-col" style="'+(isPinned?'border-left:3px solid '+color+';font-weight:700;':'')+'">' +
      '<div class="acct-cell">'+dot+av24m+'<span style="overflow:hidden;text-overflow:ellipsis;" title="@'+a.name+'">'+acctLink(a.name, a.igUrl, '@'+a.name)+'</span></div></td>' +
      rowVals.map(v => '<td class="cell" style="'+cellStyle(v,rowMax)+'">'+(v>0?v.toLocaleString():'–')+'</td>').join('') +
      '</tr>';
  }).join('');
}

function togglePin(name) {
  const i = pinnedAccounts.indexOf(name);
  if (i !== -1) pinnedAccounts.splice(i,1); else pinnedAccounts.push(name);
  renderMatrix();
  renderPinnedStrip();
  renderTrend();
}

// ── Pinned strip ──────────────────────────────────────────────────────────────
function renderPinnedStrip() {
  const strip = document.getElementById('pinnedStrip');
  const label = document.getElementById('trendModeLabel');
  if (!pinnedAccounts.length) {
    strip.innerHTML = '<span class="pinned-empty">Showing total across all accounts · Click a matrix row to compare individual accounts</span>';
    label.textContent = '· All accounts total';
    return;
  }
  label.textContent = '· '+pinnedAccounts.length+' account'+(pinnedAccounts.length>1?'s':'')+' pinned';
  strip.innerHTML = '<span style="font-size:11px;color:#6a7282;font-weight:700;">PINNED:</span> ' +
    pinnedAccounts.map((name,i) => {
      const c = COLORS[i%COLORS.length];
      return '<span class="pinned-pill" style="color:'+c+';border-color:'+c+'30;background:'+c+'12" data-acct="'+name+'" onclick="togglePin(this.dataset.acct)">'+
        '<span style="width:8px;height:8px;border-radius:50%;background:'+c+';display:inline-block;margin-right:4px;"></span>@'+name+
        ' <span style="opacity:0.5;margin-left:4px;font-size:12px;">✕</span></span>';
    }).join('') +
    ' <span style="font-size:11px;color:#6a7282;cursor:pointer;text-decoration:underline;" onclick="pinnedAccounts=[];renderMatrix();renderPinnedStrip();renderTrend();">clear all</span>';
}

// ── Trend chart ───────────────────────────────────────────────────────────────
function setTrendMetric(btn, val) {
  currentTrend = val;
  document.querySelectorAll('#trendMetricGroup .btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTrend();
}

function renderTrend() {
  const idx  = getColIndices();
  const cols = getVisibleLabels(idx);
  let datasets;

  function getVal(a, i) {
    const src = currentGran === 'monthly' ? a.monthly : a.weekly;
    const b   = src[i];
    if (!b) return 0;
    if (currentTrend === 'eng') return b.posts>0 ? Math.round((b.likes+b.views)/b.posts) : 0;
    return b[currentTrend] || 0;
  }

  if (!pinnedAccounts.length) {
    const data = idx.map(j => {
      if (currentTrend === 'eng') {
        let p=0,e=0;
        D.accounts.forEach(a => { const b=(currentGran==='monthly'?a.monthly:a.weekly)[j]||{}; p+=b.posts||0; e+=(b.likes||0)+(b.views||0); });
        return p>0?Math.round(e/p):0;
      }
      return D.accounts.reduce((s,a) => { const b=(currentGran==='monthly'?a.monthly:a.weekly)[j]||{}; return s+(b[currentTrend]||0); }, 0);
    });
    datasets = [{ label:'All Accounts', data, borderColor:'#ED0000', backgroundColor:'#ED000015', borderWidth:2.5, pointRadius:3, pointHoverRadius:6, tension:0.35, fill:false }];
  } else {
    datasets = pinnedAccounts.map((name,i) => {
      const a = D.accounts.find(x=>x.name===name);
      const data = idx.map(j => getVal(a,j));
      const c    = COLORS[i%COLORS.length];
      return { label:'@'+name, data, borderColor:c, backgroundColor:c+'15', borderWidth:2.5, pointRadius:4, pointHoverRadius:6, tension:0.35, fill:false };
    });
  }

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: { labels: cols, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position:'bottom', labels:{ font:{size:11}, boxWidth:12, padding:14 } },
        tooltip: { mode:'index', intersect:false }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:11}, maxTicksLimit:14} },
        y: { beginAtZero:true, ticks:{font:{size:11}} }
      },
      interaction: { mode:'nearest', axis:'x', intersect:false },
      animation: { duration:200 }
    }
  });
}

// ── Viral posts ───────────────────────────────────────────────────────────────
function renderViral() {
  const { from, to } = getRangeWindow();
  const filtered = D.viral.filter(p => {
    const d = new Date(p.timestamp);
    return d >= from && d <= to;
  }).sort((a,b) => (b.likes+b.views)-(a.likes+a.views));

  document.getElementById('viralHint').textContent = filtered.length+' posts · sorted by likes + views';

  document.getElementById('viralBody').innerHTML = filtered.length
    ? filtered.map(p => {
        const thumb = p.displayUrl
          ? '<img class="viral-thumb" src="'+p.displayUrl+'" loading="lazy" onerror="this.style.display=\\'none\\'">'
          : '<div class="viral-thumb-placeholder">'+(typeIcon[p.type]||'📷')+'</div>';
        const acctData = D.accounts.find(a => a.name === p.account);
        const av24v = acctData ? avatarImg(acctData.profilePic, acctData.initials, 'av-24', 24) : '';
        const igUrl = acctData ? acctData.igUrl : 'https://www.instagram.com/'+p.account+'/';
        return '<tr>' +
          '<td>'+thumb+'</td>' +
          '<td><div class="acct-cell">'+av24v+acctLink(p.account, igUrl, '<span style="font-weight:700;font-size:12px;">@'+p.account+'</span>')+'</div></td>' +
          '<td style="color:#6a7282;font-size:12px;white-space:nowrap;">'+p.date+'</td>' +
          '<td><span class="badge gray">'+p.type+'</span></td>' +
          '<td><strong>'+p.likes.toLocaleString()+'</strong></td>' +
          '<td>'+(p.views?p.views.toLocaleString():'–')+'</td>' +
          '<td><span class="caption-text" title="'+p.caption.replace(/"/g,'&quot;')+'">'+p.caption+'</span></td>' +
          '<td><a href="'+p.url+'" target="_blank" class="post-link">View →</a></td></tr>';
      }).join('')
    : '<tr><td colspan="8" style="text-align:center;color:#6a7282;padding:28px;">No posts in selected range</td></tr>';
}

// ── Render all ────────────────────────────────────────────────────────────────
function renderAll() {
  renderKPIs();
  renderInsights();
  renderRankings();
  renderMatrix();
  renderPinnedStrip();
  renderTrend();
  renderViral();
}

updateBadge();
renderAll();
<\/script>
</body>
</html>`;

  fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html, 'utf8');
  const picCount = Object.keys(profilePics).length;
  console.log(`✅ dashboard.html written (${posts.length} posts · ${DATA.accounts.length} accounts · ${DATA.months.length} months · ${DATA.weeks.length} weeks · ${picCount}/22 profile pics embedded)`);
}

buildAndWrite().catch(e => { console.error('Fatal:', e); process.exit(1); });
