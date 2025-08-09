const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Configure axios defaults for better reliability
axios.defaults.timeout = 10000; // 10 second timeout

app.use(cors());

app.get("/", (req, res) => {
  res.send("✅ Roblox Proxy Server is Running!");
});

// api response stuff with error handling
async function getPaginatedResults(url, maxPages = 50) {
  let cursor = null;
  let results = [];
  let pageCount = 0;

  while (pageCount < maxPages) {
    try {
      const response = await axios.get(url + (cursor ? `&cursor=${cursor}` : ""));
      results.push(...response.data.data);

      if (!response.data.nextPageCursor) break;
      cursor = response.data.nextPageCursor;
      pageCount++;
    } catch (err) {
      console.error(`Error fetching page ${pageCount + 1}:`, err.message);
      throw err;
    }
  }

  return results;
}

// limited count check with UGC support
app.get("/limiteds/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    let regularLimiteds = 0;
    let ugcLimiteds = 0;
    const seenAssetIds = new Set();
    
    // 1. Get regular limiteds (collectibles)
    const collectiblesUrl = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`;
    try {
      const collectibles = await getPaginatedResults(collectiblesUrl);
      collectibles.forEach(item => {
        if (item.assetId) {
          seenAssetIds.add(item.assetId);
        }
      });
      regularLimiteds = collectibles.length;
      console.log(`Regular limiteds for user ${userId}: ${regularLimiteds}`);
    } catch (err) {
      if (
        err.response &&
        (err.response.status === 403 ||
          err.response.data?.errors?.some(e => e.message.toLowerCase().includes("not authorized")))
      ) {
        return res.json({ private: true });
      }
      throw err;
    }
    
    // 2. Get UGC limiteds (optional - only if you need this)
    // Limiting to just a few asset types for better performance
    const assetTypes = [8, 41, 42]; // Hat, Hair, Face only
    
    for (const assetType of assetTypes) {
      const invUrl = `https://inventory.roblox.com/v2/users/${userId}/inventory/${assetType}?limit=100`;
      
      try {
        let invCursor = null;
        let pageCount = 0;
        const maxPagesPerType = 10; // Limit pages per asset type
        
        while (pageCount < maxPagesPerType) {
          const invResponse = await axios.get(invUrl + (invCursor ? `&cursor=${invCursor}` : ""), {
            timeout: 5000 // 5 second timeout per request
          });
          
          // Filter for items that are limited and not already counted
          const limitedItems = invResponse.data.data.filter(item => {
            const isLimited = item.collectibleItemId || 
                            item.collectibleProductId || 
                            item.serialNumber || 
                            (item.assetDetails && item.assetDetails.isLimited);
            
            if (isLimited && item.assetId && !seenAssetIds.has(item.assetId)) {
              seenAssetIds.add(item.assetId);
              return true;
            }
            return false;
          });
          
          ugcLimiteds += limitedItems.length;
          
          if (!invResponse.data.nextPageCursor) break;
          invCursor = invResponse.data.nextPageCursor;
          pageCount++;
        }
      } catch (invErr) {
        // Log but don't fail the entire request
        console.error(`Error fetching asset type ${assetType}:`, invErr.message);
        if (invErr.response && invErr.response.status === 403) {
          break; // Stop checking other types if inventory is private
        }
        continue;
      }
    }
    
    console.log(`UGC limiteds for user ${userId}: ${ugcLimiteds}`);
    
    const totalLimiteds = regularLimiteds + ugcLimiteds;
    console.log(`Total limiteds for user ${userId}: ${totalLimiteds}`);
    
    res.json({ count: totalLimiteds });
    
  } catch (err) {
    console.error("Limiteds Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch limiteds." });
  }
});

// badge count check
app.get("/badges/:userId", async (req, res) => {
  const { userId } = req.params;
  const url = `https://badges.roblox.com/v1/users/${userId}/badges?limit=100`;

  try {
    // private inv?
    const preview = await axios.get(url);
    if (Array.isArray(preview.data.data) && preview.data.data.length === 0) {
      return res.json({ private: true });
    }

    // if not private, get badges
    const badges = await getPaginatedResults(url);
    res.json({ count: badges.length });
  } catch (err) {
    if (
      err.response &&
      (err.response.status === 403 ||
        err.response.data?.errors?.some(e => e.message.toLowerCase().includes("not authorized")))
    ) {
      return res.json({ private: true });
    }
    console.error("Badges Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch badges." });
  }
});

// sum of all placevisits
app.get("/visits/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    let totalVisits = 0;
    let cursor = "";
    let hasNextPage = true;
    let pageCount = 0;
    const maxPages = 20; // Limit to prevent infinite loops

    while (hasNextPage && pageCount < maxPages) {
      const response = await axios.get(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=2&limit=50&sortOrder=Asc&cursor=${cursor}`);
      const data = response.data;

      for (const game of data.data) {
        totalVisits += game.placeVisits || 0;
      }

      if (data.nextPageCursor) {
        cursor = data.nextPageCursor;
        pageCount++;
      } else {
        hasNextPage = false;
      }
    }

    res.json({ total: totalVisits });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch visit count." });
  }
});

// getting join date thing
app.get("/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const url = `https://users.roblox.com/v1/users/${userId}`;

  try {
    const response = await axios.get(url);
    const userData = response.data;
    
    // get join date
    const joinYear = userData.created ? parseInt(userData.created.substring(0, 4)) : null;
    
    res.json({
      id: userData.id,
      name: userData.name,
      displayName: userData.displayName,
      created: userData.created,
      joinYear: joinYear,
      isBanned: userData.isBanned
    });
  } catch (err) {
    console.error("User Info Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch user info." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

