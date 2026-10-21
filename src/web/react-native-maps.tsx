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
  onUserLocationChange?: (e: { nativeEvent: { coordinate?: LatLng & { heading?: number | null; speed?: number | null } } }) => void;
  /** Fired when the user starts dragging the map by hand */
  onPanDrag?: () => void;
  onMapReady?: () => void;
  onRegionChangeComplete?: (r: Region) => void;
  /** Right-click on a laptop, long-press on a touch screen */
  onLongPress?: (e: { nativeEvent: { coordinate: LatLng } }) => void;
  mapPadding?: EdgePadding;
  /** Same JSON style array as react-native-maps' customMapStyle (light / dark theme) */
  customMapStyle?: google.maps.MapTypeStyle[];
} & Record<string, any>;

export type MapViewHandle = {
  /** heading / pitch need a vector map (cloud Map ID) on the web, so only centre + zoom are applied */
  animateCamera: (c: { center?: LatLng; zoom?: number; heading?: number; pitch?: number }, opts?: { duration?: number }) => void;
  animateToRegion: (r: Region, duration?: number) => void;
  fitToCoordinates: (coords: LatLng[], opts?: { edgePadding?: EdgePadding; animated?: boolean }) => void;
};

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;

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

/**
 * Positions an arbitrary DOM element on the map. `anchor` is the point of the element (0–1 of its
 * width / height, like react-native-maps' Marker anchor) that sits on the coordinate.
 */
function createHtmlOverlay(el: HTMLElement, anchor: { x: number; y: number }) {
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
      el.style.left = `${p.x - el.offsetWidth * anchor.x}px`;
      el.style.top = `${p.y - el.offsetHeight * anchor.y}px`;
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

/** Land colour of a style (first `geometry` rule) — used behind tiles while they load */
function baseColor(style?: google.maps.MapTypeStyle[]): string {
  const rule = style?.find((r) => !r.featureType && r.elementType === 'geometry');
  return (rule?.stylers?.[0] as { color?: string } | undefined)?.color ?? '#E5E3DF';
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
  {
    style,
    children,
    showsUserLocation,
    onUserLocationChange,
    onRegionChangeComplete,
    onLongPress,
    onPanDrag,
    mapPadding,
    customMapStyle,
    onMapReady,
  },
  ref,
) {
  const el = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const cbs = useRef({ onUserLocationChange, onRegionChangeComplete, onLongPress, onPanDrag, onMapReady });
  cbs.current = { onUserLocationChange, onRegionChangeComplete, onLongPress, onPanDrag, onMapReady };
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
          styles: customMapStyle,
          backgroundColor: baseColor(customMapStyle),
          disableDefaultUI: true,
          // Pinch / scroll-wheel zoom; the +/- control would sit under the app's bottom bar
          zoomControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        m.addListener('contextmenu', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            cbs.current.onLongPress?.({
              nativeEvent: { coordinate: { latitude: e.latLng.lat(), longitude: e.latLng.lng() } },
            });
          }
        });
        m.addListener('dragstart', () => cbs.current.onPanDrag?.());
        m.addListener('idle', () => {
          const r = regionOf(m);
          if (r) cbs.current.onRegionChangeComplete?.(r);
        });
        setMap(m);
        google.maps.event.addListenerOnce(m, 'idle', () => cbs.current.onMapReady?.());
      })
      .catch((e) => setFailed(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // Theme switch (light ↔ dark) restyles the live map
  useEffect(() => {
    map?.setOptions({ styles: customMapStyle, backgroundColor: baseColor(customMapStyle) });
  }, [map, customMapStyle]);

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
          nativeEvent: {
            coordinate: { latitude: pos.lat, longitude: pos.lng, heading: p.coords.heading, speed: p.coords.speed },
          },
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
      animateCamera: (c) => {
        if (!map) return;
        if (c.zoom != null && Math.round(map.getZoom() ?? 0) !== Math.round(c.zoom)) map.setZoom(c.zoom);
        if (c.center) map.panTo({ lat: c.center.latitude, lng: c.center.longitude });
      },
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
      <div ref={el} style={{ position: 'absolute', inset: 0, background: baseColor(customMapStyle) }} />
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
export function Marker({ coordinate, children, onPress, zIndex = 0, anchor = { x: 0.5, y: 0.5 } }: MarkerProps) {
  const map = useContext(MapContext);
  const holder = useMemo(() => document.createElement('div'), []);
  const overlay = useRef<ReturnType<typeof createHtmlOverlay> | null>(null);
  const anchorRef = useRef({ ...anchor }); // own copy — updated in place, read by draw()
  anchorRef.current.x = anchor.x;
  anchorRef.current.y = anchor.y;
  // The marker's size is only known once React has rendered into it — re-place after every render
  useEffect(() => {
    const id = requestAnimationFrame(() => overlay.current?.draw());
    return () => cancelAnimationFrame(id);
  });
  const press = useRef(onPress);
  press.current = onPress;

  useEffect(() => {
    if (!map) return;
    const o = createHtmlOverlay(holder, anchorRef.current);
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

type PolylineProps = {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  zIndex?: number;
} & Record<string, any>;

export function Polyline({ coordinates, strokeColor = '#FF6B00', strokeWidth = 4, zIndex = 0 }: PolylineProps) {
  const map = useContext(MapContext);
  useEffect(() => {
    if (!map) return;
    const line = new google.maps.Polyline({
      map,
      path: coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude })),
      strokeColor,
      strokeWeight: strokeWidth,
      strokeOpacity: 0.9,
      zIndex,
      clickable: false,
    });
    return () => line.setMap(null);
  }, [map, coordinates, strokeColor, strokeWidth, zIndex]);
  return null;
}
