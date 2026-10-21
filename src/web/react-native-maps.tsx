/**
 * Web stand-in for `react-native-maps` (which has no web support), built on Leaflet.
 * metro.config.js swaps it in for web builds only — iOS/Android still use the real
 * Google Map. Implements just the API surface the app uses.
 */
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = undefined;

export type LatLng = { latitude: number; longitude: number };
export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };
type EdgePadding = { top: number; right: number; bottom: number; left: number };

type MapViewProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  showsUserLocation?: boolean;
  onUserLocationChange?: (e: { nativeEvent: { coordinate?: LatLng } }) => void;
  onRegionChangeComplete?: (r: Region) => void;
  mapPadding?: EdgePadding;
} & Record<string, any>;

export type MapViewHandle = {
  animateToRegion: (r: Region, duration?: number) => void;
  fitToCoordinates: (coords: LatLng[], opts?: { edgePadding?: EdgePadding; animated?: boolean }) => void;
};

const MapContext = createContext<L.Map | null>(null);

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap contributors';

function regionOf(map: L.Map): Region {
  const b = map.getBounds();
  const c = map.getCenter();
  return {
    latitude: c.lat,
    longitude: c.lng,
    latitudeDelta: b.getNorth() - b.getSouth(),
    longitudeDelta: b.getEast() - b.getWest(),
  };
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { style, children, showsUserLocation, onUserLocationChange, onRegionChangeComplete, mapPadding },
  ref,
) {
  const el = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const cbs = useRef({ onUserLocationChange, onRegionChangeComplete });
  cbs.current = { onUserLocationChange, onRegionChangeComplete };
  const pad = mapPadding ?? { top: 0, right: 0, bottom: 0, left: 0 };

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([12.97, 77.59], 12);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    m.on('moveend', () => cbs.current.onRegionChangeComplete?.(regionOf(m)));
    setMap(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  // "You" = blue dot from the browser's geolocation
  useEffect(() => {
    if (!map || !showsUserLocation || !navigator.geolocation) return;
    let dot: L.CircleMarker | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const ll: L.LatLngExpression = [p.coords.latitude, p.coords.longitude];
        if (!dot) {
          dot = L.circleMarker(ll, {
            radius: 8, color: '#fff', weight: 3, fillColor: '#2F80FF', fillOpacity: 1,
          }).addTo(map);
        } else dot.setLatLng(ll);
        cbs.current.onUserLocationChange?.({
          nativeEvent: { coordinate: { latitude: p.coords.latitude, longitude: p.coords.longitude } },
        });
      },
      () => {},
      { enableHighAccuracy: true },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      dot?.remove();
    };
  }, [map, showsUserLocation]);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (r, duration = 400) => {
        if (!map) return;
        const bounds = L.latLngBounds(
          [r.latitude - r.latitudeDelta / 2, r.longitude - r.longitudeDelta / 2],
          [r.latitude + r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2],
        );
        map.flyToBounds(bounds, {
          duration: duration / 1000,
          paddingTopLeft: [pad.left, pad.top],
          paddingBottomRight: [pad.right, pad.bottom],
        });
      },
      fitToCoordinates: (coords, opts) => {
        if (!map || !coords.length) return;
        const e = opts?.edgePadding ?? pad;
        map.flyToBounds(L.latLngBounds(coords.map((c) => [c.latitude, c.longitude] as [number, number])), {
          duration: opts?.animated === false ? 0 : 0.6,
          paddingTopLeft: [e.left, e.top],
          paddingBottomRight: [e.right, e.bottom],
          maxZoom: 16,
        });
      },
    }),
    [map, pad.top, pad.right, pad.bottom, pad.left],
  );

  return (
    <View style={style}>
      <div ref={el} style={{ position: 'absolute', inset: 0, background: '#0E0F12' }} />
      {/* Dark-mode the light OSM tiles to match the app theme */}
      <style>{'.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9)}'}</style>
      <MapContext.Provider value={map}>{map && children}</MapContext.Provider>
    </View>
  );
});

export default MapView;

type MarkerProps = {
  coordinate: LatLng;
  children?: ReactNode;
  onPress?: () => void;
  zIndex?: number;
  anchor?: { x: number; y: number };
} & Record<string, any>;

/** Renders the React children (the custom rider marker) inside a Leaflet divIcon. */
export function Marker({ coordinate, children, onPress, zIndex = 0 }: MarkerProps) {
  const map = useContext(MapContext);
  const holder = useMemo(() => document.createElement('div'), []);
  const marker = useRef<L.Marker | null>(null);
  const press = useRef(onPress);
  press.current = onPress;

  useEffect(() => {
    if (!map) return;
    // Rider marker is 90px wide with a 30px dot on top → anchor on the dot's centre
    const icon = L.divIcon({ html: holder, className: '', iconSize: [90, 50], iconAnchor: [45, 15] });
    const m = L.marker([coordinate.latitude, coordinate.longitude], { icon }).addTo(map);
    m.on('click', () => press.current?.());
    marker.current = m;
    return () => {
      m.remove();
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, holder]);

  useEffect(() => {
    marker.current?.setLatLng([coordinate.latitude, coordinate.longitude]);
  }, [coordinate.latitude, coordinate.longitude]);

  useEffect(() => {
    marker.current?.setZIndexOffset(zIndex);
  }, [zIndex]);

  return createPortal(children, holder);
}
