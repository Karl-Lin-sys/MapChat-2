export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  markers?: MapMarker[];
}

export interface MapMarker {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
}
