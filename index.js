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
    
// Get current game user is playing with server info
app.get("/playing/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    // First, get user presence to check if they're online and in a game
    const presenceResponse = await axios.post(
      "https://presence.roblox.com/v1/presence/users",
      {
        userIds: [parseInt(userId)]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    const userPresence = presenceResponse.data.userPresences[0];
    
    // Log for debugging
    console.log(`Presence data for ${userId}:`, userPresence);
    
    // Check if user is in a game (type 2) or in studio (type 3)
    if (!userPresence || (userPresence.userPresenceType !== 2 && userPresence.userPresenceType !== 3)) {
      return res.json({ 
        playing: false,
        message: "Not playing game",
        presenceType: userPresence?.userPresenceType || 0,
        presenceData: userPresence // Include raw data for debugging
      });
    }
    
    // Get various IDs - Roblox uses different fields sometimes
    const placeId = userPresence.placeId || userPresence.rootPlaceId;
    const gameId = userPresence.gameId || userPresence.universeId;
    const lastLocation = userPresence.lastLocation;
    
    if (!gameId && !placeId) {
      return res.json({ 
        playing: false,
        message: "Game ID not available",
        presenceData: userPresence
      });
    }
    
    // If we have a gameId, get game details
    let gameData = null;
    if (gameId) {
      try {
        const gameResponse = await axios.get(
          `https://games.roblox.com/v1/games?universeIds=${gameId}`
        );
        gameData = gameResponse.data.data[0];
      } catch (err) {
        console.log("Failed to get game details:", err.message);
      }
    }
    
    // If we couldn't get game data from universe ID, try place ID
    if (!gameData && placeId) {
      try {
        const placeResponse = await axios.get(
          `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`
        );
        if (placeResponse.data && placeResponse.data.length > 0) {
          const placeData = placeResponse.data[0];
          gameData = {
            name: placeData.name,
            description: placeData.description,
            creator: placeData.builder,
            playing: placeData.playerCount
          };
        }
      } catch (err) {
        console.log("Failed to get place details:", err.message);
      }
    }
    
    // Build server info
    let serverInfo = {
      jobId: userPresence.gameInstanceId || null,
      lastLocation: lastLocation || "Unknown",
      placeId: placeId,
      rootPlaceId: userPresence.rootPlaceId || null
    };
    
    res.json({
      playing: true,
      gameId: gameId || null,
      placeId: placeId || null,
      gameName: gameData?.name || "Unknown Game",
      gameDescription: gameData?.description || null,
      creator: gameData?.creator || null,
      price: gameData?.price || null,
      playingCount: gameData?.playing || null,
      server: serverInfo,
      presenceType: userPresence.userPresenceType,
      isInStudio: userPresence.userPresenceType === 3
    });
    
  } catch (err) {
    console.error("Playing Status Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch playing status.", details: err.response?.data });
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

