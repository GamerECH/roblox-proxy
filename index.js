const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/", (req, res) => {
  res.send("✅ Roblox Proxy Server is Running!");
});

// api response stuff
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

// Get groups owned by user
async function getOwnedGroups(userId) {
  try {
    const response = await axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
    const ownedGroups = response.data.data.filter(group => group.role.rank === 255); // 255 is owner rank
    return ownedGroups;
  } catch (err) {
    console.error("Error fetching owned groups:", err.message);
    return [];
  }
}

// Get games from a group
async function getGroupGames(groupId) {
  try {
    let totalVisits = 0;
    let cursor = "";
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await axios.get(`https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=2&limit=100&cursor=${cursor}`);
      const data = response.data;

      for (const game of data.data) {
        totalVisits += game.placeVisits || 0;
      }

      if (data.nextPageCursor) {
        cursor = data.nextPageCursor;
      } else {
        hasNextPage = false;
      }
    }

    return totalVisits;
  } catch (err) {
    console.error(`Error fetching games for group ${groupId}:`, err.message);
    return 0;
  }
}

// limited count check
app.get("/limiteds/:userId", async (req, res) => {
  const { userId } = req.params;
  const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`;

  try {
    const assets = await getPaginatedResults(url);
    res.json({ count: assets.length });
  } catch (err) {
    if (
      err.response &&
      (err.response.status === 403 ||
        err.response.data?.errors?.some(e => e.message.toLowerCase().includes("not authorized")))
    ) {
      return res.json({ private: true });
    }
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

// sum of all placevisits, including group games where user is owner
app.get("/visits/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    let totalVisits = 0;
    
    // Get user's own games
    let cursor = "";
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await axios.get(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=2&limit=50&sortOrder=Asc&cursor=${cursor}`);
      const data = response.data;

      for (const game of data.data) {
        totalVisits += game.placeVisits || 0;
      }

      if (data.nextPageCursor) {
        cursor = data.nextPageCursor;
      } else {
        hasNextPage = false;
      }
    }

    // Get groups owned by user
    const ownedGroups = await getOwnedGroups(userId);
    
    // Get games from owned groups
    for (const group of ownedGroups) {
      const groupVisits = await getGroupGames(group.group.id);
      totalVisits += groupVisits;
    }

    res.json({ 
      total: totalVisits,
      ownedGroups: ownedGroups.length // Optional: include count of owned groups
    });
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

// Get current game user is playing with server info
app.get("/playing/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    // First, get user presence to check if they're online and in a game
    const presenceResponse = await axios.post(
      "https://presence.roblox.com/v1/presence/users",
      {
        userIds: [parseInt(userId)]
      }
    );
    
    const userPresence = presenceResponse.data.userPresences[0];
    
    // Check if user is in a game
    if (!userPresence || userPresence.userPresenceType !== 2) {
      return res.json({ 
        playing: false,
        message: "Not playing game" 
      });
    }
    
    // If they're in a game, get the game details
    const placeId = userPresence.placeId;
    const gameId = userPresence.gameId; // This is the universe ID
    const lastLocation = userPresence.lastLocation;
    
    if (!gameId) {
      return res.json({ 
        playing: false,
        message: "Not playing game" 
      });
    }
    
    // Get game details
    const gameResponse = await axios.get(
      `https://games.roblox.com/v1/games?universeIds=${gameId}`
    );
    
    const gameData = gameResponse.data.data[0];
    
    // Try to get server/job ID (only works if joins are public or you're friends)
    let serverInfo = {
      jobId: null,
      joinable: false,
      message: "Server info not available (private joins or not friends)"
    };
    
    // The presence API sometimes includes rootPlaceId and placeId which can help identify the server
    if (userPresence.rootPlaceId && userPresence.placeId) {
      serverInfo.rootPlaceId = userPresence.rootPlaceId;
      serverInfo.placeId = userPresence.placeId;
      
      // If lastLocation exists, it might contain server info
      if (lastLocation) {
        serverInfo.lastLocation = lastLocation;
      }
    }
    
    res.json({
      playing: true,
      gameId: gameId,
      placeId: placeId,
      gameName: gameData.name,
      gameDescription: gameData.description,
      creator: gameData.creator,
      price: gameData.price,
      playing: gameData.playing,
      server: serverInfo
    });
    
  } catch (err) {
    console.error("Playing Status Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch playing status." });
  }
});

// Optional: Add endpoint to check if you can join a user's game
app.get("/canjoin/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    const response = await axios.get(
      `https://presence.roblox.com/v1/presence/users/${userId}/canJoin`
    );
    
    res.json({
      canJoin: response.data.canJoin,
      isOnline: response.data.isOnline,
      presence: response.data.presence
    });
    
  } catch (err) {
    console.error("Can Join Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to check join status." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
