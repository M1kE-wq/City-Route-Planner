import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  CircleDot,
  Clock3,
  Flag,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  Route,
  Search,
  Trash2,
} from "lucide-react";
import "./styles.css";

const BULGARIA_CENTER = [42.7339, 25.4858];
const BULGARIA_BOUNDS = [
  [41.14, 22.35],
  [44.23, 28.75],
];

const emptyPoint = (label) => ({
  label,
  query: "",
  lat: null,
  lon: null,
  displayName: "",
});

const formatDistance = (meters) => {
  if (!Number.isFinite(meters)) return "--";
  return `${(meters / 1000).toFixed(meters > 100000 ? 0 : 1)} km`;
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return "--";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

const pointToCoords = (point) => [point.lat, point.lon];

const roleColor = {
  start: "#0f8b8d",
  stop: "#f2a900",
  end: "#d64545",
};

function makeMarkerIcon(type, index) {
  const color = roleColor[type] || roleColor.stop;
  const label = type === "start" ? "A" : type === "end" ? "B" : index + 1;
  return L.divIcon({
    className: "route-marker",
    html: `<span style="background:${color}"><b>${label}</b></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });
}

function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function LocationInput({
  id,
  title,
  icon,
  point,
  onChange,
  onPick,
  onFocusMapPick,
  onRemove,
  canRemove,
}) {
  const debouncedQuery = useDebouncedValue(point.query);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      q: trimmed,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5",
      countrycodes: "bg",
      viewbox: "22.35,44.23,28.75,41.14",
      bounded: "1",
    });

    fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        "Accept-Language": "en",
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error("Search failed");
        return response.json();
      })
      .then((data) => setResults(data))
      .catch((error) => {
        if (error.name !== "AbortError") setResults([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [debouncedQuery]);

  const chooseResult = (result) => {
    onPick({
      ...point,
      query: result.display_name,
      displayName: result.display_name,
      lat: Number(result.lat),
      lon: Number(result.lon),
    });
    setOpen(false);
  };

  return (
    <section className="location-row">
      <div className="row-heading">
        <span className="row-icon">{icon}</span>
        <span>{title}</span>
        {canRemove && (
          <button className="icon-button subtle" type="button" onClick={onRemove} title="Remove stop">
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <div className="search-field">
        <Search size={16} />
        <input
          id={id}
          value={point.query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange({ ...point, query: event.target.value, lat: null, lon: null, displayName: "" });
            setOpen(true);
          }}
          placeholder="Search city, address, landmark"
        />
        <button className="icon-button" type="button" onClick={onFocusMapPick} title="Pick on map">
          <LocateFixed size={16} />
        </button>
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="suggestions">
          {loading && <div className="suggestion muted">Searching Bulgaria...</div>}
          {results.map((result) => (
            <button key={result.place_id} type="button" className="suggestion" onClick={() => chooseResult(result)}>
              {result.display_name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MapView({ points, route, activePick, onMapPick }) {
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map("map", {
      zoomControl: false,
      maxBounds: BULGARIA_BOUNDS,
      maxBoundsViscosity: 0.7,
    }).setView(BULGARIA_CENTER, 7);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on("click", (event) => onMapPick(event.latlng));
  }, [onMapPick]);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;

    layerRef.current.clearLayers();
    const boundsItems = [];

    if (route?.coordinates?.length) {
      const line = L.polyline(
        route.coordinates.map(([lon, lat]) => [lat, lon]),
        {
          color: "#0b4f6c",
          weight: 6,
          opacity: 0.95,
          lineJoin: "round",
        },
      );
      line.addTo(layerRef.current);
      boundsItems.push(...line.getLatLngs());
    }

    points.forEach((point, index) => {
      if (!point.lat || !point.lon) return;
      const marker = L.marker(pointToCoords(point), {
        icon: makeMarkerIcon(point.type, point.stopIndex ?? index),
      }).bindPopup(`<strong>${point.title}</strong><br>${point.displayName || point.query}`);
      marker.addTo(layerRef.current);
      boundsItems.push(marker.getLatLng());
    });

    if (boundsItems.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(boundsItems), { padding: [48, 48], maxZoom: 12 });
    } else if (boundsItems.length === 1) {
      mapRef.current.setView(boundsItems[0], 12);
    }
  }, [points, route]);

  return (
    <div className="map-shell">
      <div id="map" />
      {activePick && (
        <div className="pick-banner">
          <MapPin size={18} />
          Click the map to set {activePick.label}
        </div>
      )}
    </div>
  );
}

function App() {
  const [start, setStart] = useState(emptyPoint("starting point"));
  const [end, setEnd] = useState(emptyPoint("end point"));
  const [stops, setStops] = useState([]);
  const [activePick, setActivePick] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeStatus, setRouteStatus] = useState("Add a start and end point.");

  const orderedPoints = useMemo(() => {
    const mappedStops = stops.map((stop, index) => ({
      ...stop,
      type: "stop",
      title: `Stop ${index + 1}`,
      stopIndex: index,
    }));
    return [
      { ...start, type: "start", title: "Start" },
      ...mappedStops,
      { ...end, type: "end", title: "End" },
    ];
  }, [start, stops, end]);

  const routablePoints = orderedPoints.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

  useEffect(() => {
    if (!Number.isFinite(start.lat) || !Number.isFinite(end.lat)) {
      setRoute(null);
      setRouteStatus("Add a start and end point.");
      return;
    }

    const controller = new AbortController();
    const coordinates = orderedPoints
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .map((point) => `${point.lon},${point.lat}`)
      .join(";");

    setRouteStatus("Calculating route...");

    fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error("Route service failed");
        return response.json();
      })
      .then((data) => {
        const bestRoute = data.routes?.[0];
        if (!bestRoute) throw new Error("No route found");
        setRoute({
          distance: bestRoute.distance,
          duration: bestRoute.duration,
          coordinates: bestRoute.geometry.coordinates,
        });
        setRouteStatus("Route ready.");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setRoute(null);
        setRouteStatus("Could not calculate that route. Try nearby road locations.");
      });

    return () => controller.abort();
  }, [start, end, orderedPoints]);

  const updateStop = (index, value) => {
    setStops((current) => current.map((stop, stopIndex) => (stopIndex === index ? value : stop)));
  };

  const handleMapPick = (latlng) => {
    if (!activePick) return;
    const pickedPoint = {
      label: activePick.label,
      query: `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`,
      displayName: "Picked on map",
      lat: latlng.lat,
      lon: latlng.lng,
    };

    if (activePick.kind === "start") setStart(pickedPoint);
    if (activePick.kind === "end") setEnd(pickedPoint);
    if (activePick.kind === "stop") updateStop(activePick.index, pickedPoint);
    setActivePick(null);
  };

  const addStop = () => {
    setStops((current) => [...current, emptyPoint(`stop ${current.length + 1}`)]);
  };

  const clearRoute = () => {
    setStart(emptyPoint("starting point"));
    setEnd(emptyPoint("end point"));
    setStops([]);
    setRoute(null);
    setActivePick(null);
  };

  return (
    <main className="app">
      <MapView points={orderedPoints} route={route} activePick={activePick} onMapPick={handleMapPick} />
      <aside className="planner-panel">
        <header className="brand">
          <div className="brand-mark">
            <Navigation size={25} />
          </div>
          <div>
            <h1>Bulgaria GPS</h1>
            <p>Plan routes across Bulgaria</p>
          </div>
        </header>

        <div className="summary-grid">
          <div className="summary-tile">
            <Route size={18} />
            <span>Distance</span>
            <strong>{formatDistance(route?.distance)}</strong>
          </div>
          <div className="summary-tile">
            <Clock3 size={18} />
            <span>Time</span>
            <strong>{formatDuration(route?.duration)}</strong>
          </div>
        </div>

        <div className="status-line">{routeStatus}</div>

        <div className="locations">
          <LocationInput
            id="start"
            title="Starting Point"
            icon={<CircleDot size={17} />}
            point={start}
            onChange={setStart}
            onPick={setStart}
            onFocusMapPick={() => setActivePick({ kind: "start", label: "starting point" })}
          />

          {stops.map((stop, index) => (
            <LocationInput
              key={index}
              id={`stop-${index}`}
              title={`Stop ${index + 1}`}
              icon={<MapPin size={17} />}
              point={stop}
              onChange={(value) => updateStop(index, value)}
              onPick={(value) => updateStop(index, value)}
              onFocusMapPick={() => setActivePick({ kind: "stop", index, label: `stop ${index + 1}` })}
              onRemove={() => setStops((current) => current.filter((_, stopIndex) => stopIndex !== index))}
              canRemove
            />
          ))}

          <LocationInput
            id="end"
            title="End Point"
            icon={<Flag size={17} />}
            point={end}
            onChange={setEnd}
            onPick={setEnd}
            onFocusMapPick={() => setActivePick({ kind: "end", label: "end point" })}
          />
        </div>

        <div className="actions">
          <button className="primary-action" type="button" onClick={addStop}>
            <Plus size={18} />
            Add Stop
          </button>
          <button className="secondary-action" type="button" onClick={clearRoute}>
            Clear
          </button>
        </div>

        <footer className="panel-footer">
          Uses OpenStreetMap search and public OSRM routing. Internet is required for live maps and routes.
        </footer>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
