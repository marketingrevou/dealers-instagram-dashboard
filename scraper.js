require("dotenv").config();
const { ApifyClient } = require("apify-client");
const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");

// Comparison windows
const BEFORE_DATE = new Date("2025-01-11T00:00:00Z"); // before 11 Jan 2025
const AFTER_DATE  = new Date("2025-04-09T23:59:59Z"); // after 9 Apr 2025

// Max posts to fetch per account (increase if accounts are very active)
const RESULTS_LIMIT = 300;

// ── Account list ──────────────────────────────────────────────────────────────
const RAW_ACCOUNTS = [
  "marketingmobil137.id",
  "bosowaberlianurip",
  "sunstarprimamotorfatmawati",
  "mitsubishibosowakairagimanado",
  "atho_mitsubishiserang",
  "dennymitsubishibukittinggi",
  "rismamitsubishisolo",
  "Mitsubishicibubur.linda",
  "mobil_mitsubishi.co.id",
  "bumenredjaabadi_sidoarjo",
  "mitsubishidipo.arengka",
  "mitsubishi_tangeranggg",
  "dena_century",
  "sunstarmotorkenjeran",
  "mitsubishi.gresik",
  "mitsubishimedan_melvin",
  "Halena_mitsubishibandung",
  "Salesmedioker.mdn",
  "mitsubishi.dipopuri",
  "ramdhan_mitsubishijakarta",
  "halomitsubishi",
  "sunstarmotorsurabaya",
];

const ACCOUNTS = RAW_ACCOUNTS.map((u) => ({
  username: u.toLowerCase(),
  url: `https://www.instagram.com/${u}/`,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function classify(post) {
  const ts = new Date(post.timestamp);
  if (ts < BEFORE_DATE) return "before";
  if (ts > AFTER_DATE) return "after";
  return "between"; // Jan 11 – Apr 9 gap, excluded from comparison
}

function emptyStats() {
  return { posts: 0, likes: 0, views: 0 };
}

function accumulate(stats, post) {
  stats.posts += 1;
  stats.likes += post.likesCount || 0;
  // Video / Reel views
  stats.views += post.videoViewCount || post.videoPlayCount || 0;
}

function pct(a, b) {
  if (b === 0) return a === 0 ? "0%" : "+∞%";
  const change = ((a - b) / b) * 100;
  return (change >= 0 ? "+" : "") + change.toFixed(1) + "%";
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// ── Scrape one account ────────────────────────────────────────────────────────
async function scrapeAccount(client, account) {
  console.log(`  Scraping @${account.username} …`);

  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: [account.url],
    resultsType: "posts",
    resultsLimit: RESULTS_LIMIT,
    addParentData: false,
    scrapePostsUntilDate: BEFORE_DATE.toISOString().split("T")[0], // stop early if possible
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!APIFY_TOKEN) {
    console.error(
      "\n❌  APIFY_TOKEN not set.\n" +
      "   1. Get your token at https://console.apify.com/account/integrations\n" +
      "   2. Create a .env file:  APIFY_TOKEN=apify_api_xxxx\n"
    );
    process.exit(1);
  }

  const client = new ApifyClient({ token: APIFY_TOKEN });

  console.log(`\n🚀  Mitsubishi Instagram Scraper`);
  console.log(`   Period A (before): < ${BEFORE_DATE.toDateString()}`);
  console.log(`   Period B (after):  > ${AFTER_DATE.toDateString()}`);
  console.log(`   Accounts: ${ACCOUNTS.length}\n`);

  if (DRY_RUN) {
    console.log("⚠️  DRY RUN — listing accounts only, no API calls.\n");
    ACCOUNTS.forEach((a) => console.log(`   • ${a.url}`));
    return;
  }

  const results = [];
  const allPosts = [];

  for (const account of ACCOUNTS) {
    try {
      const posts = await scrapeAccount(client, account);
      allPosts.push(...posts.map((p) => ({ ...p, _account: account.username })));

      const before = emptyStats();
      const after  = emptyStats();

      for (const post of posts) {
        const period = classify(post);
        if (period === "before") accumulate(before, post);
        if (period === "after")  accumulate(after, post);
      }

      results.push({ account: account.username, before, after });
    } catch (err) {
      console.warn(`  ⚠️  Failed @${account.username}: ${err.message}`);
      results.push({
        account: account.username,
        before: emptyStats(),
        after: emptyStats(),
        error: err.message,
      });
    }
  }

  // ── Save raw data ───────────────────────────────────────────────────────────
  fs.writeFileSync("raw-posts.json", JSON.stringify(allPosts, null, 2));
  console.log(`\n💾  Raw data saved to raw-posts.json (${allPosts.length} posts)\n`);

  // ── Print comparison table ──────────────────────────────────────────────────
  const COL = [28, 7, 9, 9, 7, 9, 9];
  const header = [
    "Account",
    "Posts↑", "Likes↑", "Views↑",
    "Posts↓", "Likes↓", "Views↓",
  ];

  const sep = COL.map((c) => "-".repeat(c)).join("+");
  const row = (cols) => cols.map((c, i) => pad(c, COL[i])).join("|");

  console.log("\n📊  COMPARISON TABLE");
  console.log(`   ↑ = Before Jan 11, 2025   ↓ = After Apr 9, 2025\n`);
  console.log(sep);
  console.log(row(header));
  console.log(sep);

  // Totals
  const totals = { before: emptyStats(), after: emptyStats() };

  for (const r of results) {
    accumulate(totals.before, {
      likesCount: r.before.likes,
      videoViewCount: r.before.views,
    });
    totals.before.posts += r.before.posts;
    accumulate(totals.after, {
      likesCount: r.after.likes,
      videoViewCount: r.after.views,
    });
    totals.after.posts += r.after.posts;

    console.log(
      row([
        r.account + (r.error ? " ⚠️" : ""),
        r.before.posts,
        r.before.likes.toLocaleString(),
        r.before.views.toLocaleString(),
        r.after.posts,
        r.after.likes.toLocaleString(),
        r.after.views.toLocaleString(),
      ])
    );
  }

  console.log(sep);
  console.log(
    row([
      "TOTAL",
      totals.before.posts,
      totals.before.likes.toLocaleString(),
      totals.before.views.toLocaleString(),
      totals.after.posts,
      totals.after.likes.toLocaleString(),
      totals.after.views.toLocaleString(),
    ])
  );
  console.log(
    row([
      "CHANGE",
      pct(totals.after.posts, totals.before.posts),
      pct(totals.after.likes, totals.before.likes),
      pct(totals.after.views, totals.before.views),
      "", "", "",
    ])
  );
  console.log(sep);

  // ── Save CSV ────────────────────────────────────────────────────────────────
  const csvRows = [
    "account,before_posts,before_likes,before_views,after_posts,after_likes,after_views",
    ...results.map(
      (r) =>
        `${r.account},${r.before.posts},${r.before.likes},${r.before.views},` +
        `${r.after.posts},${r.after.likes},${r.after.views}`
    ),
  ];
  fs.writeFileSync("comparison.csv", csvRows.join("\n"));
  console.log("\n✅  Results saved to comparison.csv\n");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
