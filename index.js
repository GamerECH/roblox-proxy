const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/", (req, res) => {
  res.send("✅ Roblox Proxy Server is Running!");
});

// Fixed pagination function
async function getPaginatedResults(url) {
  let cursor = "";
  let results = [];
  let pageCount = 0;

  while (true) {
    try {
      const fullUrl = url + (cursor ? `&cursor=${cursor}` : "");
      console.log(`Fetching page ${pageCount + 1}: ${fullUrl}`);
      
      const response = await axios.get(fullUrl);
      
      if (response.data.data) {
        results.push(...response.data.data);
        console.log(`Page ${pageCount + 1}: Got ${response.data.data.length} items, total so far: ${results.length}`);
      }

      if (!response.data.nextPageCursor) {
        console.log("No more pages");
        break;
      }
      
      cursor = response.data.nextPageCursor;
      pageCount++;
      
      // Safety limit
      if (pageCount > 100) {
        console.log("Hit page limit");
        break;
      }
    } catch (err) {
      console.error(`Error on page ${pageCount + 1}:`, err.message);
      throw err;
    }
  }

  return results;
}

// Limited count with UGC support
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
    
    // 2. Get UGC limiteds - check all accessory types
    const assetTypes = [8, 41, 42, 43, 44, 45, 46, 47]; // Hat, Hair, Face, Neck, Shoulder, Front, Back, Waist
    
    for (const assetType of assetTypes) {
      console.log(`Checking asset type ${assetType}...`);
      
      try {
        let invCursor = "";
        let typePageCount = 0;
        
        while (true) {
          const invUrl = `https://inventory.roblox.com/v2/users/${userId}/inventory/${assetType}?limit=100${invCursor ? `&cursor=${invCursor}` : ""}`;
          
          const invResponse = await axios.get(invUrl, {
            timeout: 10000 // 10 second timeout
          });
          
          if (invResponse.data.data) {
            // Filter for items that are limited and not already counted
            const limitedItems = invResponse.data.data.filter(item => {
              // Check multiple fields that indicate a limited item
              const isLimited = item.collectibleItemId || 
                              item.collectibleProductId || 
                              item.serialNumber || 
                              item.isLimited ||
                              (item.collectibleItemDetails && item.collectibleItemDetails.collectibleItemId);
              
              if (isLimited && item.assetId && !seenAssetIds.has(item.assetId)) {
                seenAssetIds.add(item.assetId);
                return true;
              }
              return false;
            });
            
            ugcLimiteds += limitedItems.length;
            
            if (limitedItems.length > 0) {
              console.log(`Found ${limitedItems.length} UGC limiteds in asset type ${assetType}`);
            }
          }
          
          if (!invResponse.data.nextPageCursor) break;
          invCursor = invResponse.data.nextPageCursor;
          typePageCount++;
          
          // Limit pages per type to avoid excessive requests
          if (typePageCount > 20) break;
        }
      } catch (invErr) {
        console.error(`Error fetching asset type ${assetType}:`, invErr.message);
        if (invErr.response && invErr.response.status === 403) {
          console.log("Inventory is private, stopping UGC check");
          break;
        }
        // Continue with next asset type
      }
    }
    
    console.log(`UGC limiteds for user ${userId}: ${ugcLimiteds}`);
    
    const totalLimiteds = regularLimiteds + ugcLimiteds;
    console.log(`Total limiteds for user ${userId}: ${totalLimiteds}`);
    
    res.json({ 
      count: totalLimiteds,
      regular: regularLimiteds,
      ugc: ugcLimiteds 
    });
    
  } catch (err) {
    console.error("Limiteds Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch limiteds." });
  }
});

// Fixed badge count check
app.get("/badges/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    let allBadges = [];
    let cursor = "";
    let pageCount = 0;
    
    // First check if inventory is private
    const firstPageUrl = `https://badges.roblox.com/v1/users/${userId}/badges?limit=100`;
    const firstPage = await axios.get(firstPageUrl);
    
    if (Array.isArray(firstPage.data.data) && firstPage.data.data.length === 0 && !firstPage.data.nextPageCursor) {
      return res.json({ private: true });
    }
    
    // Add first page results
    allBadges.push(...firstPage.data.data);
    cursor = firstPage.data.nextPageCursor;
    
    // Get remaining pages
    while (cursor) {
      const url = `https://badges.roblox.com/v1/users/${userId}/badges?limit=100&cursor=${cursor}`;
      console.log(`Fetching badge page ${pageCount + 2}`);
      
      const response = await axios.get(url);
      
      if (response.data.data) {
        allBadges.push(...response.data.data);
      }
      
      cursor = response.data.nextPageCursor;
      pageCount++;
      
      // Safety limit
      if (pageCount > 500) {
        console.log("Hit badge page limit");
        break;
      }
    }
    
    console.log(`Total badges for user ${userId}: ${allBadges.length}`);
    res.json({ count: allBadges.length });
    
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

    while (hasNextPage) {
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
      
      // Safety limit
      if (pageCount > 50) break;
    }

    console.log(`Total visits for user ${userId}: ${totalVisits}`);
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


