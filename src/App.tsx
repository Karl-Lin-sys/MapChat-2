import { useEffect, useRef, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, InfoWindow } from '@vis.gl/react-google-maps';
import { Send, MapPin, Loader2, Navigation } from 'lucide-react';
import { ChatMessage, MapMarker } from './types';
import { cn } from './lib/utils';
import ReactMarkdown from 'react-markdown';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

function MapController({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || markers.length === 0) return;
    
    if (markers.length === 1) {
      map.panTo({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(15);
    } else {
      const bounds = new google.maps.LatLngBounds();
      markers.forEach(m => bounds.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(bounds);
    }
  }, [map, markers]);
  return null;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "model",
    content: "Hi! I'm MapChat. Ask me anything about places, local searches, or directions."
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeMarkers, setActiveMarkers] = useState<MapMarker[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
  
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.log("Geolocation error:", err)
      );
    }
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const newMessages: ChatMessage[] = [
      ...messages,
      { id: Date.now().toString(), role: "user", content: input.trim() }
    ];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          userLocation
        }),
      });

      if (!res.ok) {
         const err = await res.json();
         throw new Error(err.error || "Failed to fetch response");
      }
      const data = await res.json();
      
      let rawText = data.text;
      let markersObj: MapMarker[] = [];
      
      // Attempt to extract markdown json block for markers
      const markerMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
      if (markerMatch) {
         try {
           markersObj = JSON.parse(markerMatch[1]);
           // Remove the JSON block from the text shown to the user
           rawText = rawText.replace(markerMatch[0], '').trim();
         } catch (err) {}
      }

      setMessages(prev => [...prev, {
        id: Date.now().toString() + "-model",
        role: "model",
        content: rawText,
        markers: markersObj
      }]);
      
      if (markersObj.length > 0) {
        setActiveMarkers(markersObj);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + "-error",
        role: "model",
        content: `**Error:** ${err.message}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!hasValidKey) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 text-slate-900 font-sans">
        <div className="text-center max-w-lg p-8 bg-white rounded-2xl shadow-sm border border-slate-200">
          <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
             <MapPin className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight mb-2">Google Maps API Key Required</h2>
          <p className="text-slate-500 mb-6 font-medium">To run the map and spatial chatting features, Please follow these steps:</p>
          <div className="text-left space-y-4 mb-6 text-sm text-slate-700">
            <p><strong>Step 1:</strong> <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noopener text-blue-600 hover:underline">Get an API Key</a></p>
            <p><strong>Step 2:</strong> Add your key as a secret securely:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Open <strong>Settings</strong> (⚙️ gear icon, <strong>top-right corner</strong>)</li>
              <li>Select <strong>Secrets</strong></li>
              <li>Type <code>GOOGLE_MAPS_PLATFORM_KEY</code> as the secret name, press <strong>Enter</strong></li>
              <li>Paste your API key as the value, press <strong>Enter</strong></li>
            </ul>
          </div>
          <p className="text-xs text-slate-400">The app builds automatically—no reload needed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar Chat */}
      <div className="w-full md:w-[400px] lg:w-[450px] flex flex-col bg-white border-r border-slate-200 z-10 shrink-0">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3 bg-white">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
            <Navigation className="w-4 h-4 fill-white" />
          </div>
          <div>
             <h1 className="font-semibold text-slate-800 leading-tight">MapChat</h1>
             <p className="text-xs font-medium text-slate-500">Gemini spatial assistant</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col max-w-[90%]",
                msg.role === "user" ? "ml-auto" : "mr-auto"
              )}
            >
              <div
                className={cn(
                  "p-3 rounded-2xl text-[15px] leading-relaxed shadow-sm",
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-slate-100 text-slate-800 rounded-tl-sm"
                )}
              >
                <div className="markdown-body [&>p]:mb-0">
                   <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
              
              {msg.markers && msg.markers.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.markers.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setActiveMarkers([m]);
                        setSelectedMarker(m);
                      }}
                      className="text-xs flex items-center gap-1.5 text-slate-500 hover:text-blue-600 transition-colors bg-white border border-slate-200 px-2 py-1 rounded-full shadow-sm"
                    >
                      <MapPin className="w-3 h-3" />
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 px-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium">MapChat is thinking...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        <div className="p-4 bg-white border-t border-slate-100">
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 bg-slate-50 p-1.5 rounded-3xl border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="E.g. Find coffee shops near me..."
              className="flex-1 bg-transparent px-4 py-2.5 text-[15px] min-w-0 outline-none placeholder:text-slate-400"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="w-10 h-10 shrink-0 bg-blue-600 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:bg-slate-300 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Map View */}
      <div className="flex-1 relative hidden md:block">
        <APIProvider apiKey={API_KEY} version="weekly">
          <Map
            defaultCenter={{ lat: 37.42, lng: -122.08 }} // default GooglePlex
            defaultZoom={12}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
            disableDefaultUI={true}
            zoomControl={true}
          >
            {userLocation && (
              <AdvancedMarker position={userLocation} title="Your Location">
                 <Pin background="#22c55e" borderColor="#166534" glyphColor="#fff" />
              </AdvancedMarker>
            )}

            {activeMarkers.map((marker) => (
              <AdvancedMarker
                key={marker.place_id}
                position={{ lat: marker.lat, lng: marker.lng }}
                onClick={() => setSelectedMarker(marker)}
              >
                <Pin background="#2563eb" borderColor="#1d4ed8" glyphColor="#fff" />
              </AdvancedMarker>
            ))}

            {selectedMarker && (
              <InfoWindow
                position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
                onCloseClick={() => setSelectedMarker(null)}
              >
                <div className="font-sans font-medium text-slate-800 text-sm max-w-[200px]">
                  {selectedMarker.name}
                </div>
              </InfoWindow>
            )}

            <MapController markers={activeMarkers} />
          </Map>
        </APIProvider>
      </div>
    </div>
  );
}
