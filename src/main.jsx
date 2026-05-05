import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowLeftRight,
  CircleDot,
  Clock3,
  Crosshair,
  Flag,
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

const ROUTE_COLOR = "#0b4f6c";
const SAME_POINT_THRESHOLD_METERS = 35;

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

const formatStepDistance = (meters) => {
  if (!Number.isFinite(meters)) return "";
  if (meters >= 1000) return `in ${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
  return `in ${Math.max(10, Math.round(meters / 10) * 10)} m`;
};

const directionText = {
  "slight right": "slight right",
  right: "right",
  "sharp right": "sharp right",
  "slight left": "slight left",
  left: "left",
  "sharp left": "sharp left",
  straight: "straight",
  uturn: "make a U-turn",
};

const formatManeuverInstruction = (step) => {
  const maneuver = step?.maneuver || {};
  const road = step?.name ? ` onto ${step.name}` : "";
  const modifier = directionText[maneuver.modifier] || maneuver.modifier || "";

  if (maneuver.type === "depart") return `Head ${modifier || "out"}${road}`;
  if (maneuver.type === "arrive") return "Arrive at your destination";
  if (maneuver.type === "roundabout" || maneuver.type === "rotary") {
    const exit = maneuver.exit ? ` and take exit ${maneuver.exit}` : "";
    return `Enter the roundabout${exit}${road}`;
  }
  if (maneuver.type === "merge") return `Merge ${modifier}${road}`.trim();
  if (maneuver.type === "on ramp") return `Take the ramp ${modifier}${road}`.trim();
  if (maneuver.type === "off ramp") return `Take the exit ${modifier}${road}`.trim();
  if (maneuver.type === "fork") return `Keep ${modifier}${road}`.trim();
  if (maneuver.type === "continue") return `Continue ${modifier}${road}`.trim();
  if (maneuver.type === "turn" || maneuver.type === "new name") return `Turn ${modifier}${road}`.trim();

  return `${maneuver.type || "Continue"} ${modifier}${road}`.trim();
};

const getNextInstruction = (legs = []) => {
  const steps = legs.flatMap((leg) => leg.steps || []);
  const nextStep =
    steps.find((step) => !["depart", "arrive"].includes(step.maneuver?.type) && step.distance > 15) ||
    steps.find((step) => step.maneuver?.type !== "arrive") ||
    steps[0];

  if (!nextStep) return null;

  return {
    distance: nextStep.distance,
    distanceText: formatStepDistance(nextStep.distance),
    instruction: formatManeuverInstruction(nextStep),
  };
};

const pointToCoords = (point) => [point.lat, point.lon];

const isPointSet = (point) => Boolean(point) && Number.isFinite(point.lat) && Number.isFinite(point.lon);

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const toDegrees = (radians) => (radians * 180) / Math.PI;

const distanceBetweenPoints = (a, b) => {
  if (!isPointSet(a) || !isPointSet(b)) return Infinity;

  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const bearingBetweenPoints = (from, to) => {
  if (!isPointSet(from) || !isPointSet(to)) return 0;

  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

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

function makeUserLocationIcon(bearing, isNavigating) {
  if (!isNavigating) {
    return L.divIcon({
      className: "user-location-dot",
      html: "<span></span>",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  return L.divIcon({
    className: "user-location-marker",
    html: `<span style="transform: rotate(${bearing}deg)"><b></b></span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
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

function MapView({ points, route, activePick, onMapPick, userLocation, navigationActive, userBearing }) {
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
          color: ROUTE_COLOR,
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
        icon: makeUserLocationIcon(userBearing, navigationActive),
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
  }, [points, route, userLocation, navigationActive, userBearing]);

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
  const [nextInstruction, setNextInstruction] = useState(null);
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

  const hasValidRouteEndpoints = isPointSet(start) && isPointSet(end);

  const routePoints = useMemo(() => {
    if (!navigationActive || !isPointSet(userLocation) || !hasValidRouteEndpoints) {
      return orderedPoints;
    }

    const shouldAddCurrentLocation =
      distanceBetweenPoints(userLocation, start) > SAME_POINT_THRESHOLD_METERS;

    if (!shouldAddCurrentLocation) {
      return orderedPoints;
    }

    return [
      {
        ...userLocation,
        type: "user",
        title: "Current location",
      },
      ...orderedPoints,
    ];
  }, [navigationActive, userLocation, hasValidRouteEndpoints, orderedPoints, start]);

  const userBearing = useMemo(() => {
    if (!isPointSet(userLocation)) return 0;
    const nextPoint = routePoints.find((point) => point.type !== "user" && isPointSet(point));
    return bearingBetweenPoints(userLocation, nextPoint);
  }, [routePoints, userLocation]);

  useEffect(() => {
    if (!hasValidRouteEndpoints) {
      setRoute(null);
      setNextInstruction(null);
      setRouteStatus("Add a start and end point.");
      return;
    }

    const controller = new AbortController();
    const coordinates = routePoints
      .filter((point) => isPointSet(point))
      .map((point) => `${point.lon},${point.lat}`)
      .join(";");

    setRouteStatus(navigationActive ? "Calculating route from your location..." : "Calculating car route...");

    const fetchRoute = () => {
      const params = new URLSearchParams({
        overview: "full",
        geometries: "geojson",
        steps: "true",
      });

      return fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?${params.toString()}`, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("Route service failed");
        return response.json();
      });
    };

    fetchRoute()
      .then((response) => {
        const data = response;
        const bestRoute = data.routes?.[0];
        if (!bestRoute) throw new Error("No route found");

        setRoute({
          distance: bestRoute.distance,
          duration: bestRoute.duration,
          coordinates: bestRoute.geometry.coordinates,
        });
        setNextInstruction(navigationActive ? getNextInstruction(bestRoute.legs) : null);
        setRouteStatus(
          navigationActive ? "Navigation route ready." : "Car route ready.",
        );
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setRoute(null);
        setNextInstruction(null);
        setRouteStatus("Could not calculate that route. Try nearby road locations.");
      });

    return () => controller.abort();
  }, [hasValidRouteEndpoints, routePoints, navigationActive]);

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
    setNextInstruction(null);
  };

  const addStop = () => {
    setStops((current) => [...current, emptyPoint(`stop ${current.length + 1}`)]);
  };

  const clearRoute = () => {
    setStart(emptyPoint("starting point"));
    setEnd(emptyPoint("end point"));
    setStops([]);
    setRoute(null);
    setNextInstruction(null);
    setActivePick(null);
    setNavigationActive(false);
  };

  const finishNavigation = () => {
    setNavigationActive(false);
    setNextInstruction(null);
    setRouteStatus("Route finished.");
  };

  const reverseRoute = () => {
    setStart({ ...end, label: "starting point" });
    setEnd({ ...start, label: "end point" });
    setStops((current) => [...current].reverse());
    setNavigationActive(false);
    setNextInstruction(null);
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
      setNextInstruction(null);
    });
  };

  const startNavigation = () => {
    const begin = (location) => {
      setUserLocation(location);
      setActivePick(null);
      setNavigationActive(true);
      setRouteStatus("Navigation started from your current location.");
    };

    if (!hasValidRouteEndpoints) {
      return;
    }

    if (isPointSet(userLocation)) {
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
        userLocation={userLocation}
        navigationActive={navigationActive}
        userBearing={userBearing}
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

        {!navigationActive && (
          <>
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
              {hasValidRouteEndpoints && (
                <button className="start-action" type="button" onClick={startNavigation}>
                  <Play size={18} />
                  Start Route
                </button>
              )}
              <button className="secondary-action" type="button" onClick={clearRoute}>
                Clear
              </button>
            </div>
          </>
        )}

        {navigationActive && (
          <div className="navigation-actions">
            <div className="next-turn">
              <div className="next-turn-icon">
                <Navigation size={22} />
              </div>
              <div>
                <span>Next maneuver</span>
                <strong>{nextInstruction?.instruction || "Follow the highlighted route"}</strong>
                {nextInstruction?.distanceText && <em>{nextInstruction.distanceText}</em>}
              </div>
            </div>
            <button className="finish-action" type="button" onClick={finishNavigation}>
              <Flag size={18} />
              End Route
            </button>
          </div>
        )}

        <footer className="panel-footer">
          Uses OpenStreetMap search and public OSRM routing. Internet is required for live maps and routes.
        </footer>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
