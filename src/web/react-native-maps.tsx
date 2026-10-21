/// <reference types="google.maps" />
/**
 * Web stand-in for `react-native-maps` (which has no web support), built on the
 * Google Maps JavaScript API. metro.config.js swaps it in for web builds only —
 * iOS/Android still use the native Google Map. Implements just the API surface the app uses.
 */
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
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

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

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;

// Matches the app's dark theme (styles only apply to maps without a cloud Map ID)
const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1d2026' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0aa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e0f12' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2e323a' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a4134' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#d8c3a5' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b2233' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3a3f48' }] },
];

let loading: Promise<typeof google.maps> | null = null;

/** Loads the Maps JavaScript API once per page. */
function loadGoogleMaps(): Promise<typeof google.maps> {
  if ((window as any).google?.maps?.Map) return Promise.resolve(google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = '__rtMapsReady';
    (window as any)[cb] = () => resolve(google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&v=weekly&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Google Maps'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Positions an arbitrary DOM element on the map, centred on a coordinate's dot. */
function createHtmlOverlay(el: HTMLElement, anchorX: number, anchorY: number) {
  class HtmlOverlay extends google.maps.OverlayView {
    pos: google.maps.LatLng | null = null;
    onAdd() {
      el.style.position = 'absolute';
      // overlayMouseTarget so the marker can be clicked
      this.getPanes()!.overlayMouseTarget.appendChild(el);
    }
    draw() {
      const p = this.pos && this.getProjection()?.fromLatLngToDivPixel(this.pos);
      if (!p) return;
      el.style.left = `${p.x - anchorX}px`;
      el.style.top = `${p.y - anchorY}px`;
    }
    onRemove() {
      el.remove();
    }
    setPosition(lat: number, lng: number) {
      this.pos = new google.maps.LatLng(lat, lng);
      this.draw();
    }
  }
  return new HtmlOverlay();
}

function regionOf(map: google.maps.Map): Region | null {
  const b = map.getBounds();
  const c = map.getCenter();
  if (!b || !c) return null;
  const ne = b.getNorthEast(), sw = b.getSouthWest();
  return {
    latitude: c.lat(),
    longitude: c.lng(),
    latitudeDelta: ne.lat() - sw.lat(),
    longitudeDelta: ne.lng() - sw.lng(),
  };
}

const MapContext = createContext<google.maps.Map | null>(null);

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { style, children, showsUserLocation, onUserLocationChange, onRegionChangeComplete, mapPadding },
  ref,
) {
  const el = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const cbs = useRef({ onUserLocationChange, onRegionChangeComplete });
  cbs.current = { onUserLocationChange, onRegionChangeComplete };
  const pad = mapPadding ?? { top: 0, right: 0, bottom: 0, left: 0 };

  useEffect(() => {
    if (!API_KEY) {
      setFailed('Map unavailable: EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is not set.');
      return;
    }
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !el.current) return;
        const m = new google.maps.Map(el.current, {
          center: { lat: 12.97, lng: 77.59 },
          zoom: 12,
          styles: DARK_STYLE,
          backgroundColor: '#0E0F12',
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        m.addListener('idle', () => {
          const r = regionOf(m);
          if (r) cbs.current.onRegionChangeComplete?.(r);
        });
        setMap(m);
      })
      .catch((e) => setFailed(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // "You" = blue dot from the browser's geolocation
  useEffect(() => {
    if (!map || !showsUserLocation || !navigator.geolocation) return;
    let dot: google.maps.Marker | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        if (!dot) {
          dot = new google.maps.Marker({
            map,
            position: pos,
            zIndex: 2000,
            clickable: false,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#2F80FF',
              fillOpacity: 1,
              strokeColor: '#FFFFFF',
              strokeWeight: 3,
            },
          });
        } else dot.setPosition(pos);
        cbs.current.onUserLocationChange?.({
          nativeEvent: { coordinate: { latitude: pos.lat, longitude: pos.lng } },
        });
      },
      () => {},
      { enableHighAccuracy: true },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      dot?.setMap(null);
    };
  }, [map, showsUserLocation]);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (r) => {
        if (!map) return;
        const bounds = new google.maps.LatLngBounds(
          { lat: r.latitude - r.latitudeDelta / 2, lng: r.longitude - r.longitudeDelta / 2 },
          { lat: r.latitude + r.latitudeDelta / 2, lng: r.longitude + r.longitudeDelta / 2 },
        );
        map.fitBounds(bounds, pad);
      },
      fitToCoordinates: (coords, opts) => {
        if (!map || !coords.length) return;
        const bounds = new google.maps.LatLngBounds();
        coords.forEach((c) => bounds.extend({ lat: c.latitude, lng: c.longitude }));
        map.fitBounds(bounds, opts?.edgePadding ?? pad);
        // A single rider / tight group would otherwise zoom in to street level
        google.maps.event.addListenerOnce(map, 'idle', () => {
          if ((map.getZoom() ?? 0) > 16) map.setZoom(16);
        });
      },
    }),
    [map, pad.top, pad.right, pad.bottom, pad.left],
  );

  return (
    <View style={style}>
      <div ref={el} style={{ position: 'absolute', inset: 0, background: '#0E0F12' }} />
      {failed && (
        <View style={{ position: 'absolute', top: '45%', left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: '#9AA0AA' }}>{failed}</Text>
        </View>
      )}
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

/** Renders the React children (the custom rider marker) as an HTML overlay on the map. */
export function Marker({ coordinate, children, onPress, zIndex = 0 }: MarkerProps) {
  const map = useContext(MapContext);
  const holder = useMemo(() => document.createElement('div'), []);
  const overlay = useRef<ReturnType<typeof createHtmlOverlay> | null>(null);
  const press = useRef(onPress);
  press.current = onPress;

  useEffect(() => {
    if (!map) return;
    // Rider marker is 90px wide with a 30px dot on top → anchor on the dot's centre
    const o = createHtmlOverlay(holder, 45, 15);
    o.setPosition(coordinate.latitude, coordinate.longitude);
    o.setMap(map);
    holder.style.cursor = 'pointer';
    const click = (e: MouseEvent) => {
      e.stopPropagation();
      press.current?.();
    };
    holder.addEventListener('click', click);
    overlay.current = o;
    return () => {
      holder.removeEventListener('click', click);
      o.setMap(null);
      overlay.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, holder]);

  useEffect(() => {
    overlay.current?.setPosition(coordinate.latitude, coordinate.longitude);
  }, [coordinate.latitude, coordinate.longitude]);

  useEffect(() => {
    holder.style.zIndex = String(zIndex);
  }, [holder, zIndex]);

  return createPortal(children, holder);
}
