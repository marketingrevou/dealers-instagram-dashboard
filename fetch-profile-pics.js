require("dotenv").config();
const { ApifyClient } = require("apify-client");
const https = require("https");
const fs = require("fs");

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const ACCOUNTS = [
  "atho_mitsubishiserang","bosowaberlianurip","bumenredjaabadi_sidoarjo",
  "dena_century","dennymitsubishibukittinggi","halena_mitsubishibandung",
  "halomitsubishi","marketingmobil137.id","mitsubishi.dipopuri",
  "mitsubishi.gresik","mitsubishi_tangeranggg","mitsubishibosowakairagimanado",
  "mitsubishicibubur.linda","mitsubishidipo.arengka","mitsubishimedan_melvin",
  "mobil_mitsubishi.co.id","ramdhan_mitsubishijakarta","rismamitsubishisolo",
  "salesmedioker.mdn","sunstarmotorkenjeran","sunstarmotorsurabaya",
  "sunstarprimamotorfatmawati"
];

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.instagram.com/" } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ data: Buffer.concat(chunks), ct: (res.headers["content-type"] || "image/jpeg").split(";")[0].trim() }));
    }).on("error", reject);
  });
}

async function main() {
  console.log(`Scraping profiles for ${ACCOUNTS.length} accounts via Apify…\n`);

  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: ACCOUNTS.map(u => `https://www.instagram.com/${u}/`),
    resultsType: "details",
    resultsLimit: 1,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`Got ${items.length} profile results\n`);

  const pics = {};
  for (const item of items) {
    const username = item.username || item.ownerUsername;
    const picUrl = item.profilePicUrlHD || item.profilePicUrl || item.profile_pic_url_hd || item.profile_pic_url;
    if (username && picUrl) {
      try {
        const { data, ct } = await downloadImage(picUrl);
        pics[username] = `data:${ct};base64,${data.toString("base64")}`;
        console.log(`OK  ${username} — ${Math.round(data.length / 1024)}KB`);
      } catch (e) {
        console.log(`ERR ${username} — download failed: ${e.message}`);
      }
    } else {
      console.log(`MISS ${username || "?"} — no pic URL`);
    }
  }

  fs.writeFileSync("profile-pics.json", JSON.stringify(pics, null, 2));
  console.log(`\nSaved ${Object.keys(pics).length} pics to profile-pics.json`);
}

main().catch(console.error);
