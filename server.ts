import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Client as GoogleMapsClient } from "@googlemaps/google-maps-services-js";
import 'dotenv/config';

// Ensure API keys are present
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAPS_API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY;

let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

const mapsClient = new GoogleMapsClient({});

// Gemini Function Declarations for Maps API tools
const mapsTools = [];

// 1. Text Search / Places Query
const searchPlacesFunc: FunctionDeclaration = {
  name: "searchPlaces",
  description: "Search for places by text query, e.g., 'Coffee shops near me', 'Eiffel tower'. Returns a list of places and their basic details.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The search string" },
      lat: { type: Type.NUMBER, description: "Optional: Latitude to bias results" },
      lng: { type: Type.NUMBER, description: "Optional: Longitude to bias results" },
      radius: { type: Type.NUMBER, description: "Optional: Radius in meters if lat/lng provided (max 50000)" }
    },
    required: ["query"]
  }
};
mapsTools.push(searchPlacesFunc);

// 2. Get Place Details
const getPlaceDetailsFunc: FunctionDeclaration = {
  name: "getPlaceDetails",
  description: "Get detailed information about a place like exact address, phone number, website, rating, formatted reviews, and opening hours. Requires a 'placeId' from a previous search.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      placeId: { type: Type.STRING, description: "The Google Maps Place ID" }
    },
    required: ["placeId"]
  }
};
mapsTools.push(getPlaceDetailsFunc);

// 3. Geocoding
const geocodeFunc: FunctionDeclaration = {
  name: "geocodeLocation",
  description: "Convert a natural language address or city name into precise latitude and longitude coordinates.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      address: { type: Type.STRING, description: "The address to geocode" }
    },
    required: ["address"]
  }
};
mapsTools.push(geocodeFunc);

const tools = [{ functionDeclarations: mapsTools }];

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(express.json());

  // API Route for chat
  app.post("/api/chat", async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({ error: "Gemini API Key missing or not configured." });
      }
      if (!MAPS_API_KEY) {
         return res.status(500).json({ error: "Google Maps API Key missing. Please add it via the Settings view." });
      }

      const { messages, userLocation } = req.body;
      // messages format: [{ role: "user" | "model", parts: [{ text: "..." }] }]
      
      const systemInstruction = `You are MapChat, a helpful assistant with deep knowledge of geography and local places.
You have access to Google Maps tools. Use them to answer questions about locations, find places, fetch details, and geocode addresses.
If a user asks about places 'near them' or 'here', prioritize using the provided user location: Lat ${userLocation?.lat}, Lng ${userLocation?.lng}.
Always provide helpful, concise, well-formatted answers.
When a place is discussed, output its place_id, lat, lng, and name so the frontend can center the map and display a marker. You MUST do this by wrapping a strictly formatted JSON array inside a markdown block at the very end of your response like this:
\`\`\`json
[{"name": "Eiffel Tower", "lat": 48.8584, "lng": 2.2945, "place_id": "ChIJLU7jZClu5kcR4PcOOO6p3I0"}]
\`\`\``;

      const chat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction,
          tools,
        }
      });
      
      // Send historical messages sequentially to build chat state before final prompt (simplified for standard single-turn text usage)
      // Standardize input format
      const formattedHistory = messages.slice(0, -1).map(m => ({
          role: m.role,
          parts: [{text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}]
      }));      
      const lastMessage = messages[messages.length - 1].content;
      
      let response = await chat.sendMessage({ message: lastMessage });
      
      // Auto-handling function calls (Gemini allows multiple turns until no function call is returned)
      while (response.functionCalls && response.functionCalls.length > 0) {
        const toolResponses = await Promise.all(response.functionCalls.map(async (call) => {
          let output;
          try {
             if (call.name === "searchPlaces") {
                const { query, lat, lng, radius } = call.args;
                const params: any = { query, key: MAPS_API_KEY };
                if (lat && lng) {
                   params.location = [lat, lng];
                   if (radius) params.radius = radius;
                }
                const placesRes = await mapsClient.textSearch({ params });
                output = placesRes.data.results.slice(0, 5).map(p => ({
                   name: p.name,
                   place_id: p.place_id,
                   formatted_address: p.formatted_address,
                   rating: p.rating,
                   user_ratings_total: p.user_ratings_total,
                   types: p.types,
                   lat: p.geometry?.location?.lat,
                   lng: p.geometry?.location?.lng
                }));
             } else if (call.name === "getPlaceDetails") {
                const params = { place_id: call.args.placeId, key: MAPS_API_KEY };
                const detailsRes = await mapsClient.placeDetails({ params });
                output = detailsRes.data.result;
             } else if (call.name === "geocodeLocation") {
                const params = { address: call.args.address, key: MAPS_API_KEY };
                const geocodeRes = await mapsClient.geocode({ params });
                output = geocodeRes.data.results.slice(0, 2).map(r => ({
                    formatted_address: r.formatted_address,
                    lat: r.geometry.location.lat,
                    lng: r.geometry.location.lng,
                    place_id: r.place_id
                }));
             } else {
                output = { error: "Unknown function call" };
             }
          } catch(e: any) {
             console.error("Tool execution error:", e.message);
             output = { error: e.message };
          }
          return { id: call.id, name: call.name, response: output };
        }));
        
        response = await chat.sendMessage({ message: toolResponses as any });
      }

      res.json({ text: response.text });

    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production / start
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
