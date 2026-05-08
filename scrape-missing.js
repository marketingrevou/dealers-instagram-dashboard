require("dotenv").config();
const { ApifyClient } = require("apify-client");
const fs = require("fs");

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const RESULTS_LIMIT = 300;

const MISSING_ACCOUNTS = [
  "salesmedioker.mdn",
  "mitsubishi.dipopuri",
  "ramdhan_mitsubishijakarta",
  "halomitsubishi",
  "sunstarmotorsurabaya",
];

async function scrapeAccount(client, username) {
  console.log(`  Scraping @${username} …`);
  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: "posts",
    resultsLimit: RESULTS_LIMIT,
    addParentData: false,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

async function main() {
  if (!APIFY_TOKEN) {
    console.error("❌  APIFY_TOKEN not set in .env");
    process.exit(1);
  }

  const client = new ApifyClient({ token: APIFY_TOKEN });

  console.log(`\n🚀  Scraping 5 missing accounts…\n`);

  const newPosts = [];

  for (const username of MISSING_ACCOUNTS) {
    try {
      const posts = await scrapeAccount(client, username);
      const tagged = posts.map((p) => ({ ...p, _account: username.toLowerCase() }));
      newPosts.push(...tagged);
      console.log(`  ✅  @${username}: ${posts.length} posts`);
    } catch (err) {
      console.warn(`  ⚠️  Failed @${username}: ${err.message}`);
    }
  }

  // Merge with existing raw-posts.json
  const existing = JSON.parse(fs.readFileSync("raw-posts.json", "utf8"));

  // Remove any previous (empty) entries for these accounts just in case
  const missingSet = new Set(MISSING_ACCOUNTS.map((u) => u.toLowerCase()));
  const filtered = existing.filter((p) => !missingSet.has(p._account));

  const merged = [...filtered, ...newPosts];
  fs.writeFileSync("raw-posts.json", JSON.stringify(merged, null, 2));
  console.log(`\n💾  raw-posts.json updated: ${merged.length} total posts`);

  // Re-run weekly report
  console.log("\n📊  Regenerating weekly CSVs…");
  require("./weekly-report.js");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
