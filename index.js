const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/", (req, res) => {
  res.send("✅ Roblox Proxy Server is Running!");
});

// Helper to paginate through Roblox API responses
async function getPaginatedResults(url) {
  let cursor = null;
  let results = [];

  while (true) {
    const response = await axios.get(url + (cursor ? `&cursor=${cursor}` : ""));
    results.push(...response.data.data);

    if (!response.data.nextPageCursor) break;
    cursor = response.data.nextPageCursor;
  }

  return results;
}

// 🚀 Limiteds count (paginated)
app.get("/limiteds/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const assets = await getPaginatedResults(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`);
    res.json({ count: assets.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch limiteds." });
  }
});

// 🌟 Visits (sums all places)
app.get("/visits/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const games = await getPaginatedResults(`https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50`);
    let totalVisits = 0;
    for (const game of games) {
      totalVisits += game.visits || 0;
    }
    res.json({ total: totalVisits });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch visits." });
  }
});

// 🏆 Badges count (paginated)
app.get("/badges/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const badges = await getPaginatedResults(`https://badges.roblox.com/v1/users/${userId}/badges?limit=100`);
    res.json({ count: badges.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch badges." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
