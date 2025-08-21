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

// Add debug endpoint to see raw presence data
app.get("/debug/presence/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
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
    
    res.json({
      raw: presenceResponse.data,
      userPresence: presenceResponse.data.userPresences[0],
      interpretation: {
        userPresenceType: presenceResponse.data.userPresences[0]?.userPresenceType,
        types: {
          0: "Offline",
          1: "Online (Website/Mobile)",
          2: "In Game",
          3: "In Studio"
        }
      }
    });
    
  } catch (err) {
    console.error("Debug Error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Enhanced playing endpoint with better subplace/VC server support
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
    console.log(`Presence data for ${userId}:`, JSON.stringify(userPresence, null, 2));
    
    // Check if user is in a game (type 2) or in studio (type 3)
    if (!userPresence || (userPresence.userPresenceType !== 2 && userPresence.userPresenceType !== 3)) {
      return res.json({ 
        playing: false,
        message: "Not playing game",
        presenceType: userPresence?.userPresenceType || 0,
        debug: {
          userPresenceType: userPresence?.userPresenceType,
          lastOnline: userPresence?.lastOnline,
          lastLocation: userPresence?.lastLocation
        }
      });
    }
    
    // Get various IDs
    const placeId = userPresence.placeId;
    const rootPlaceId = userPresence.rootPlaceId;
    const gameId = userPresence.gameId || userPresence.universeId;
    const lastLocation = userPresence.lastLocation;
    const gameInstanceId = userPresence.gameInstanceId;
    
    // Check if user is in a subplace (like VC server)
    const isInSubplace = placeId && rootPlaceId && placeId !== rootPlaceId;
    
    if (!gameId && !placeId && !rootPlaceId) {
      return res.json({ 
        playing: true,
        message: "In game but details unavailable",
        presenceType: userPresence.userPresenceType,
        debug: userPresence
      });
    }
    
    // Get game details from universe ID
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
    
    // Get details about the specific place (including subplaces)
    let currentPlaceData = null;
    let rootPlaceData = null;
    
    if (placeId) {
      try {
        const placeResponse = await axios.get(
          `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`
        );
        if (placeResponse.data && placeResponse.data.length > 0) {
          currentPlaceData = placeResponse.data[0];
        }
      } catch (err) {
        console.log("Failed to get current place details:", err.message);
      }
    }
    
    // If in a subplace, also get root place details
    if (isInSubplace && rootPlaceId) {
      try {
        const rootPlaceResponse = await axios.get(
          `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${rootPlaceId}`
        );
        if (rootPlaceResponse.data && rootPlaceResponse.data.length > 0) {
          rootPlaceData = rootPlaceResponse.data[0];
        }
      } catch (err) {
        console.log("Failed to get root place details:", err.message);
      }
    }
    
    // Try to get universe ID from place if we don't have game data
    if (!gameData && (currentPlaceData || rootPlaceData)) {
      const universeId = currentPlaceData?.universeId || rootPlaceData?.universeId;
      if (universeId) {
        try {
          const gameResponse = await axios.get(
            `https://games.roblox.com/v1/games?universeIds=${universeId}`
          );
          gameData = gameResponse.data.data[0];
        } catch (err) {
          console.log("Failed to get game from universe ID:", err.message);
        }
      }
    }
    
    // Build join links
    const joinLinks = {
      directJoin: gameInstanceId ? `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}` : null,
      placeLink: `https://www.roblox.com/games/${placeId}`,
      deepLink: gameInstanceId ? `roblox://placeId=${placeId}&gameInstanceId=${gameInstanceId}` : null,
      webJoin: gameInstanceId ? `https://www.roblox.com/home?placeId=${placeId}&gameInstanceId=${gameInstanceId}` : null
    };
    
    // Build comprehensive response
    const response = {
      playing: true,
      gameId: gameId || gameData?.id || null,
      gameName: gameData?.name || rootPlaceData?.name || currentPlaceData?.name || "Unknown Game",
      gameDescription: gameData?.description || null,
      creator: gameData?.creator || null,
      price: gameData?.price || null,
      playingCount: gameData?.playing || null,
      presenceType: userPresence.userPresenceType,
      isInStudio: userPresence.userPresenceType === 3,
      
      // Place information
      place: {
        currentPlaceId: placeId,
        currentPlaceName: currentPlaceData?.name || lastLocation || "Unknown Place",
        currentPlaceDescription: currentPlaceData?.description || null,
        isSubplace: isInSubplace,
        isVoiceEnabled: currentPlaceData?.isVoiceEnabled || false,
        
        // Root place info (main game place)
        rootPlaceId: rootPlaceId,
        rootPlaceName: rootPlaceData?.name || null,
        rootPlaceDescription: rootPlaceData?.description || null,
      },
      
      // Server information
      server: {
        jobId: gameInstanceId || null,
        lastLocation: lastLocation || "Unknown",
        playerCount: currentPlaceData?.playerCount || null,
        maxPlayers: currentPlaceData?.maxPlayerCount || null,
      },
      
      // Join information
      joinInfo: {
        canJoin: !!gameInstanceId,
        joinLinks: joinLinks,
        instructions: gameInstanceId ? 
          "Use the directJoin link to join this exact server/subplace. The deepLink works on mobile." : 
          "Cannot join specific server - no gameInstanceId available"
      },
      
      // Additional metadata
      metadata: {
        isPrivateServer: userPresence.privateServerId ? true : false,
        privateServerId: userPresence.privateServerId || null,
        lastOnline: userPresence.lastOnline,
      }
    };
    
    // Add subplace-specific info if available
    if (isInSubplace) {
      response.subplaceInfo = {
        message: "User is in a subplace (possibly VC server or special area)",
        mainGamePlaceId: rootPlaceId,
        subplacePlaceId: placeId,
        possibleVCServer: currentPlaceData?.isVoiceEnabled || lastLocation?.toLowerCase().includes('voice') || false,
        directSubplaceJoin: gameInstanceId ? 
          `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}` : 
          "Cannot join - no instance ID"
      };
    }
    
    res.json(response);
    
  } catch (err) {
    console.error("Playing Status Error:", err.response?.data || err.message);
        res.status(500).json({ error: "Failed to fetch playing status.", details: err.response?.data });
  }
});

// Get detailed place information including voice chat status
app.get("/place/:placeId", async (req, res) => {
  const { placeId } = req.params;
  
  try {
    const placeResponse = await axios.get(
      `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`
    );
    
    if (placeResponse.data && placeResponse.data.length > 0) {
      const placeData = placeResponse.data[0];
      
      // Try to get universe/game data
      let gameData = null;
      if (placeData.universeId) {
        try {
          const gameResponse = await axios.get(
            `https://games.roblox.com/v1/games?universeIds=${placeData.universeId}`
          );
          gameData = gameResponse.data.data[0];
        } catch (err) {
          console.log("Failed to get game data:", err.message);
        }
      }
      
      res.json({
        placeId: placeData.placeId,
        name: placeData.name,
        description: placeData.description,
        sourceName: placeData.sourceName,
        sourceDescription: placeData.sourceDescription,
        url: placeData.url,
        builder: placeData.builder,
        builderId: placeData.builderId,
        hasVerifiedBadge: placeData.hasVerifiedBadge,
        isPlayable: placeData.isPlayable,
        reasonProhibited: placeData.reasonProhibited,
        universeId: placeData.universeId,
        universeRootPlaceId: placeData.universeRootPlaceId,
        price: placeData.price,
        imageToken: placeData.imageToken,
        isVoiceEnabled: placeData.isVoiceEnabled || false,
        hasVoiceChat: placeData.hasVoiceChat || false,
        gameData: gameData,
        joinLinks: {
          webLink: `https://www.roblox.com/games/${placeId}`,
          directLink: `https://www.roblox.com/games/start?placeId=${placeId}`,
          deepLink: `roblox://placeId=${placeId}`
        }
      });
    } else {
      res.status(404).json({ error: "Place not found" });
    }
    
  } catch (err) {
    console.error("Place Details Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch place details." });
  }
});

// Check if you can join a user's game and get join link
app.get("/canjoin/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    // First check if we can join
    const canJoinResponse = await axios.get(
      `https://presence.roblox.com/v1/presence/users/${userId}/canJoin`
    );
    
    if (!canJoinResponse.data.canJoin) {
      return res.json({
        canJoin: false,
        reason: "User's joins are disabled or you cannot join them",
        isOnline: canJoinResponse.data.isOnline
      });
    }
    
    // Get detailed presence for join info
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
    
    if (!userPresence || userPresence.userPresenceType !== 2) {
      return res.json({
        canJoin: false,
        reason: "User is not in a game",
        presence: userPresence
      });
    }
    
    const placeId = userPresence.placeId;
    const gameInstanceId = userPresence.gameInstanceId;
    const rootPlaceId = userPresence.rootPlaceId;
    const isInSubplace = placeId && rootPlaceId && placeId !== rootPlaceId;
    
    res.json({
      canJoin: true,
      isOnline: true,
      gameInfo: {
        placeId: placeId,
        rootPlaceId: rootPlaceId,
        gameInstanceId: gameInstanceId,
        isInSubplace: isInSubplace,
        lastLocation: userPresence.lastLocation
      },
      joinLinks: {
        directJoin: gameInstanceId ? 
          `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}` : 
          `https://www.roblox.com/games/start?placeId=${placeId}`,
        webJoin: gameInstanceId ? 
          `https://www.roblox.com/home?placeId=${placeId}&gameInstanceId=${gameInstanceId}` : 
          null,
        deepLink: gameInstanceId ? 
          `roblox://placeId=${placeId}&gameInstanceId=${gameInstanceId}` : 
          `roblox://placeId=${placeId}`,
        mobileDeepLink: gameInstanceId ?
          `robloxmobile://placeId=${placeId}&gameInstanceId=${gameInstanceId}` :
          `robloxmobile://placeId=${placeId}`
      },
      instructions: {
        desktop: "Use 'directJoin' link in your browser while logged into Roblox",
        mobile: "Use 'deepLink' or 'mobileDeepLink' on mobile devices with Roblox app installed",
        note: isInSubplace ? 
          "This will join the exact subplace/VC server the user is in" : 
          "This will join the same game, but possibly a different server"
      }
    });
    
  } catch (err) {
    console.error("Can Join Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to check join status." });
  }
});

// Get server/instance details for a specific game instance
app.get("/server/:placeId/:gameInstanceId", async (req, res) => {
  const { placeId, gameInstanceId } = req.params;
  
  try {
    // Try to get server info (this endpoint might not always work)
    const serverUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100`;
    const serversResponse = await axios.get(serverUrl);
    
    // Look for the specific server
    const targetServer = serversResponse.data.data.find(
      server => server.id === gameInstanceId
    );
    
    if (targetServer) {
      res.json({
        found: true,
        server: {
          id: targetServer.id,
          maxPlayers: targetServer.maxPlayers,
          playing: targetServer.playing,
          playerTokens: targetServer.playerTokens,
          fps: targetServer.fps,
          ping: targetServer.ping
        },
        joinLink: `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}`
      });
    } else {
      res.json({
        found: false,
        message: "Server not found in public servers list",
        joinLink: `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}`,
        note: "The server might be private, full, or a subplace server"
      });
    }
    
  } catch (err) {
    console.error("Server Details Error:", err.response?.data || err.message);
    res.json({
      error: "Could not fetch server list",
      joinLink: `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}`,
      note: "You can still try joining with the provided link"
    });
  }
});

// Generate various join links for a user
app.get("/joinlinks/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    // Get user's current game
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
    
    if (!userPresence || userPresence.userPresenceType !== 2) {
      return res.json({
        error: "User is not in a game",
        presence: userPresence?.userPresenceType
      });
    }
    
    const placeId = userPresence.placeId;
    const gameInstanceId = userPresence.gameInstanceId;
    const rootPlaceId = userPresence.rootPlaceId;
    const isInSubplace = placeId && rootPlaceId && placeId !== rootPlaceId;
    
    // Generate all possible join links
    const links = {
      primary: {
        web: gameInstanceId ? 
          `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}` :
          `https://www.roblox.com/games/${placeId}`,
        description: "Main join link - works in browser"
      },
      alternative: {
        home: gameInstanceId ? 
          `https://www.roblox.com/home?placeId=${placeId}&gameInstanceId=${gameInstanceId}` : null,
        games: `https://www.roblox.com/games/${placeId}`,
        description: "Alternative web links"
      },
      deepLinks: {
        standard: gameInstanceId ? 
          `roblox://placeId=${placeId}&gameInstanceId=${gameInstanceId}` :
          `roblox://placeId=${placeId}`,
        mobile: gameInstanceId ?
          `robloxmobile://placeId=${placeId}&gameInstanceId=${gameInstanceId}` :
          `robloxmobile://placeId=${placeId}`,
        description: "Deep links for Roblox app"
      },
      subplaceSpecific: isInSubplace ? {
        note: "User is in a subplace/VC server",
        mainPlace: `https://www.roblox.com/games/${rootPlaceId}`,
        subplace: `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameInstanceId}`,
        canDirectJoin: !!gameInstanceId
      } : null
    };
    
    res.json({
      userId: userId,
      placeId: placeId,
      gameInstanceId: gameInstanceId,
      isInSubplace: isInSubplace,
      links: links,
      usage: {
        desktop: "Copy the 'primary.web' link and paste in your browser while logged in",
        mobile: "Click the 'deepLinks.mobile' link on a device with Roblox installed",
        note: gameInstanceId ? 
          "These links will join the EXACT server/subplace" : 
          "No specific server ID - will join a random server"
      }
    });
    
  } catch (err) {
    console.error("Join Links Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to generate join links" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
