# Bulgaria Route Planner

A portable local web app that resembles a simple GPS for Bulgaria. It supports a starting point, an end point, optional stops, route visualization, total distance, and estimated driving time.

## Features

- Interactive Bulgaria-focused OpenStreetMap view
- Search for places in Bulgaria with OpenStreetMap/Nominatim
- Pick start, stop, and end points directly on the map
- Add and remove stops
- Draw the driving route with public OSRM routing
- Show total distance and estimated time
- Responsive layout for desktop and mobile

## Requirements

- WSL or Linux
- Node.js and npm
- Internet access for map tiles, search, and routing

## Run Locally

From the project folder in WSL/Linux:

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite, usually:

```text
http://localhost:5173
```

## Build

```bash
npm run build
```

The production files will be created in `dist/`.

## Portability

The project is self-contained. Move or zip the folder, then run `npm install` again on another Linux/WSL machine.
