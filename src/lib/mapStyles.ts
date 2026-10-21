import type { Scheme } from './theme';

/**
 * Our own Apple-Maps-like look on top of Google Maps (same JSON format for react-native-maps'
 * `customMapStyle` and the Maps JavaScript API's `styles`): calm land, white roads with a soft edge,
 * warm highways, muted water, few labels and no business POIs.
 */
type Style = { featureType?: string; elementType?: string; stylers: Record<string, string | number>[] };

const common: Style[] = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.government', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.medical', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.sports_complex', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
];

const light: Style[] = [
  { elementType: 'geometry', stylers: [{ color: '#F4F2EE' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5E5E63' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }, { weight: 3 }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#ECEAE5' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D3EBC4' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4C7A3A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#A9D2F2' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4A7DA8' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#DCD9D2' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#FBD889' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#E8B85A' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#8A8A8F' }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#D6D3CC' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#C9C6BF' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#3A3A3C' }] },
  ...common,
];

const dark: Style[] = [
  { elementType: 'geometry', stylers: [{ color: '#1E1F23' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9C9CA2' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#121315' }, { weight: 3 }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#24252A' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1E2B21' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6E9A6A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#10243A' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5A82A8' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#3A3B41' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2A2B30' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#6B5A3A' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#4A3F2B' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#E3CFA6' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#7C7C82' }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#2F3035' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3A3B41' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#D1D1D6' }] },
  ...common,
];

export function mapStyleFor(scheme: Scheme): Style[] {
  return scheme === 'dark' ? dark : light;
}
