const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/", (req, res) => {
  res.send("✅ Roblox Proxy Server is Running!");
});

app.get("/limiteds/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const response = await axios.get(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`);
    res.json({ count: response.data.data.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch limiteds." });
  }
});

app.get("/visits/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const response = await axios.get(`https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50`);
    let totalVisits = 0;
    for (const game of response.data.data) {
      totalVisits += game.visits || 0;
    }
    res.json({ total: totalVisits });
  } catch {
    res.status(500).json({ error: "Failed to fetch visits." });
  }
});

app.get("/badges/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const response = await axios.get(`https://badges.roblox.com/v1/users/${userId}/badges?limit=100`);
    res.json({ count: response.data.data.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch badges." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
