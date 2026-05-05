import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowLeftRight,
  Bike,
  Car,
  CircleDot,
  CircleSlash,
  Clock3,
  Crosshair,
  Flag,
  Footprints,
  LocateFixed,
  MapPin,
  Navigation,
  Play,
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

const TRAVEL_MODES = {
  car: {
    label: "Car",
    profile: "driving",
    speedMetersPerSecond: 18.9,
    icon: Car,
    color: "#0b4f6c",
  },
  bike: {
    label: "Bike",
    profile: "bike",
    speedMetersPerSecond: 4.7,
    icon: Bike,
    color: "#0f8b8d",
  },
  foot: {
    label: "Foot",
    profile: "foot",
    speedMetersPerSecond: 1.35,
    icon: Footprints,
    color: "#7c4d9e",
  },
};

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

const isPointSet = (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon);

const normalizeText = (value = "") =>
  value
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const getResultName = (result) =>
  result.namedetails?.name ||
  result.address?.city ||
  result.address?.town ||
  result.address?.village ||
  result.address?.municipality ||
  result.name ||
  result.display_name.split(",")[0];

const getResultKind = (result) => {
  if (["city", "town", "village", "hamlet"].includes(result.type)) return "City / town";
  if (result.address?.road) return "Address";
  if (["administrative", "boundary"].includes(result.class)) return "Region";
  return result.type ? result.type.replaceAll("_", " ") : "Place";
};

const rankSearchResults = (results, query) => {
  const normalizedQuery = normalizeText(query);
  const seen = new Set();

  const ranked = results
    .map((result) => {
      const name = getResultName(result);
      const normalizedName = normalizeText(name);
      const isPopulatedPlace = ["city", "town", "village", "hamlet"].includes(result.type);
      const exactName = normalizedName === normalizedQuery;
      const startsWithName = normalizedName.startsWith(normalizedQuery);
      const score =
        (exactName ? 100 : 0) +
        (isPopulatedPlace ? 60 : 0) +
        (startsWithName ? 20 : 0) +
        Number(result.importance || 0);

      return { ...result, gpsName: name, gpsKind: getResultKind(result), gpsScore: score, gpsExactName: exactName };
    })
    .sort((a, b) => b.gpsScore - a.gpsScore)
    .filter((result) => {
      const key = `${normalizeText(result.gpsName)}-${result.type}-${Number(result.lat).toFixed(3)}-${Number(
        result.lon,
      ).toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const exactCityMatches = ranked.filter(
    (result) => result.gpsExactName && ["city", "town", "village", "hamlet"].includes(result.type),
  );

  if (exactCityMatches.length > 0) {
    return [exactCityMatches[0]];
  }

  return ranked;
};

const roleColor = {
  start: "#0f8b8d",
  stop: "#f2a900",
  end: "#d64545",
  user: "#172026",
};

function makeMarkerIcon(type, index) {
  const color = roleColor[type] || roleColor.stop;
  const label = type === "start" ? "A" : type === "end" ? "B" : type === "user" ? "Y" : index + 1;
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
      namedetails: "1",
      limit: "8",
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
      .then((data) => setResults(rankSearchResults(data, trimmed).slice(0, 5)))
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
          {results.map((result, index) => (
            <button key={result.place_id} type="button" className="suggestion" onClick={() => chooseResult(result)}>
              <span className="suggestion-title">
                {result.gpsName}
                {index === 0 && <span className="suggestion-badge">Best match</span>}
              </span>
              <span className="suggestion-meta">{result.gpsKind}</span>
              <span className="suggestion-detail">{result.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MapView({ points, route, activePick, onMapPick, routeMode, userLocation, navigationActive }) {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const activePickRef = useRef(activePick);
  const onMapPickRef = useRef(onMapPick);

  useEffect(() => {
    activePickRef.current = activePick;
    onMapPickRef.current = onMapPick;
    if (mapRef.current) {
      mapRef.current.getContainer().classList.toggle("is-picking", Boolean(activePick));
    }
  }, [activePick, onMapPick]);

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

    map.on("click", (event) => {
      if (!activePickRef.current) return;
      onMapPickRef.current(event.latlng, activePickRef.current);
    });
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;

    layerRef.current.clearLayers();
    const boundsItems = [];

    if (route?.coordinates?.length) {
      const line = L.polyline(
        route.coordinates.map(([lon, lat]) => [lat, lon]),
        {
          color: TRAVEL_MODES[routeMode].color,
          weight: 6,
          opacity: 0.95,
          lineJoin: "round",
        },
      );
      line.addTo(layerRef.current);
      boundsItems.push(...line.getLatLngs());
    }

    points.forEach((point, index) => {
      if (!isPointSet(point)) return;
      const marker = L.marker(pointToCoords(point), {
        icon: makeMarkerIcon(point.type, point.stopIndex ?? index),
      }).bindPopup(`<strong>${point.title}</strong><br>${point.displayName || point.query}`);
      marker.addTo(layerRef.current);
      boundsItems.push(marker.getLatLng());
    });

    if (userLocation) {
      const marker = L.marker([userLocation.lat, userLocation.lon], {
        icon: makeMarkerIcon("user"),
      }).bindPopup("<strong>Your location</strong>");
      marker.addTo(layerRef.current);
      boundsItems.push(marker.getLatLng());
    }

    if (navigationActive && userLocation) {
      mapRef.current.setView([userLocation.lat, userLocation.lon], 16);
      return;
    }

    if (boundsItems.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(boundsItems), { padding: [48, 48], maxZoom: 12 });
    } else if (boundsItems.length === 1) {
      mapRef.current.setView(boundsItems[0], 12);
    }
  }, [points, route, routeMode, userLocation, navigationActive]);

  return (
    <div className="map-shell">
      <div id="map" />
      {activePick && (
        <div className="pick-banner">
          <MapPin size={18} />
          Click the map to set {activePick.label}
        </div>
      )}
      {navigationActive && userLocation && (
        <div className="navigation-banner">
          <Navigation size={18} />
          Follow the highlighted route from your location.
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
  const [routeMode, setRouteMode] = useState("car");
  const [avoidHighways, setAvoidHighways] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [navigationActive, setNavigationActive] = useState(false);

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

  useEffect(() => {
    if (!isPointSet(start) || !isPointSet(end)) {
      setRoute(null);
      setRouteStatus("Add a start and end point.");
      return;
    }

    const controller = new AbortController();
    const coordinates = orderedPoints
      .filter((point) => isPointSet(point))
      .map((point) => `${point.lon},${point.lat}`)
      .join(";");
    const selectedMode = TRAVEL_MODES[routeMode];

    setRouteStatus(`Calculating ${selectedMode.label.toLowerCase()} route...`);

    const fetchRoute = (profile, useAvoidHighways = avoidHighways) => {
      const params = new URLSearchParams({
        overview: "full",
        geometries: "geojson",
        steps: "false",
      });

      if (useAvoidHighways) {
        params.set("exclude", "motorway");
      }

      return fetch(`https://router.project-osrm.org/route/v1/${profile}/${coordinates}?${params.toString()}`, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("Route service failed");
        return response.json();
      });
    };

    const routeRequest =
      routeMode === "car"
        ? fetchRoute(selectedMode.profile).catch((error) => {
            if (error.name === "AbortError" || !avoidHighways) throw error;
            return fetchRoute(selectedMode.profile, false).then((data) => ({ ...data, highwayFallback: true }));
          })
        : fetchRoute(selectedMode.profile)
            .catch((error) => {
              if (error.name === "AbortError") throw error;
              return fetchRoute(TRAVEL_MODES.car.profile).then((data) => ({ ...data, fallbackEstimate: true }));
            })
            .catch((error) => {
              if (error.name === "AbortError" || !avoidHighways) throw error;
              return fetchRoute(TRAVEL_MODES.car.profile, false).then((data) => ({
                ...data,
                fallbackEstimate: true,
                highwayFallback: true,
              }));
            });

    routeRequest
      .then((response) => {
        const data = response;
        const bestRoute = data.routes?.[0];
        if (!bestRoute) throw new Error("No route found");
        const duration = data.fallbackEstimate
          ? bestRoute.distance / selectedMode.speedMetersPerSecond
          : bestRoute.duration;

        setRoute({
          distance: bestRoute.distance,
          duration,
          coordinates: bestRoute.geometry.coordinates,
          estimatedMode: data.fallbackEstimate,
          highwayFallback: data.highwayFallback,
        });
        setRouteStatus(
          data.highwayFallback
            ? "Route ready. This public router could not avoid highways for this route."
            : data.fallbackEstimate
            ? `${selectedMode.label} route ready. Time is estimated from road distance.`
            : `${selectedMode.label} route ready${avoidHighways ? " without highways" : ""}.`,
        );
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setRoute(null);
        setRouteStatus("Could not calculate that route. Try nearby road locations.");
      });

    return () => controller.abort();
  }, [start, end, orderedPoints, routeMode, avoidHighways]);

  const updateStop = (index, value) => {
    setStops((current) => current.map((stop, stopIndex) => (stopIndex === index ? value : stop)));
  };

  const handleMapPick = (latlng, pickTarget = activePick) => {
    if (!pickTarget) return;
    const pickedPoint = {
      label: pickTarget.label,
      query: `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`,
      displayName: "Picked on map",
      lat: latlng.lat,
      lon: latlng.lng,
    };

    if (pickTarget.kind === "start") setStart(pickedPoint);
    if (pickTarget.kind === "end") setEnd(pickedPoint);
    if (pickTarget.kind === "stop") updateStop(pickTarget.index, pickedPoint);
    setActivePick(null);
    setNavigationActive(false);
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
    setNavigationActive(false);
  };

  const reverseRoute = () => {
    setStart({ ...end, label: "starting point" });
    setEnd({ ...start, label: "end point" });
    setStops((current) => [...current].reverse());
    setNavigationActive(false);
  };

  const requestCurrentLocation = (onSuccess) => {
    if (!navigator.geolocation) {
      setRouteStatus("Current location is not available in this browser.");
      return;
    }

    setRouteStatus("Finding your current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          label: "starting point",
          query: "Current location",
          displayName: "Your current location",
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setUserLocation(location);
        setRouteStatus("Current location found.");
        onSuccess?.(location);
      },
      () => {
        setRouteStatus("Could not access current location. Check browser location permission.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  };

  const useCurrentLocationAsStart = () => {
    requestCurrentLocation((location) => {
      setStart(location);
      setNavigationActive(false);
    });
  };

  const startNavigation = () => {
    const begin = (location) => {
      if (!isPointSet(start)) {
        setStart(location);
      }
      setUserLocation(location);
      setActivePick(null);
      setNavigationActive(true);
      setRouteStatus(isPointSet(end) ? "Navigation started." : "Add an end point to show the route.");
    };

    if (userLocation) {
      begin(userLocation);
      return;
    }

    requestCurrentLocation(begin);
  };

  return (
    <main className="app">
      <MapView
        points={orderedPoints}
        route={route}
        activePick={activePick}
        onMapPick={handleMapPick}
        routeMode={routeMode}
        userLocation={userLocation}
        navigationActive={navigationActive}
      />
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

        <div className="mode-control" aria-label="Travel mode">
          {Object.entries(TRAVEL_MODES).map(([mode, config]) => {
            const ModeIcon = config.icon;
            return (
              <button
                key={mode}
                type="button"
                className={routeMode === mode ? "mode-button active" : "mode-button"}
                onClick={() => setRouteMode(mode)}
              >
                <ModeIcon size={17} />
                {config.label}
              </button>
            );
          })}
        </div>

        <label className="avoid-toggle">
          <input
            type="checkbox"
            checked={avoidHighways}
            onChange={(event) => setAvoidHighways(event.target.checked)}
          />
          <CircleSlash size={17} />
          Avoid highways
        </label>

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
          <button className="secondary-action icon-label" type="button" onClick={reverseRoute}>
            <ArrowLeftRight size={17} />
            Reverse
          </button>
          <button className="secondary-action icon-label" type="button" onClick={useCurrentLocationAsStart}>
            <Crosshair size={17} />
            Current
          </button>
          <button className="start-action" type="button" onClick={startNavigation}>
            <Play size={18} />
            Start Route
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
