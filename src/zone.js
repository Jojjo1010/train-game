// Zone map: a graph of stations connected by paths
// Player starts at station 0, goal is to reach the final station

export const STATION_TYPES = {
  COMBAT: 'combat',
  EMPTY: 'empty',
  START: 'start',
  EXIT: 'exit',
};

const COAL_PER_HOP = 1;
const STARTING_COAL = 6;

export class Station {
  constructor(id, x, y, type) {
    this.id = id;
    this.x = x; // map position (0-1 normalized)
    this.y = y;
    this.type = type;
    this.connections = []; // station IDs this connects to
    this.visited = false;
    this.revealed = false; // only show type if adjacent to visited
  }
}

export class Zone {
  constructor(difficulty = 1) {
    this.stations = [];
    this.currentStation = 0;
    this.coal = STARTING_COAL;
    this.maxCoal = STARTING_COAL;
    this.difficulty = difficulty;
    this.stationsVisited = 0;
    this.completed = false;
    this.failed = false;

    this.generate();
    this.stations[0].visited = true;
    this.stations[0].revealed = true;
    this.revealAdjacent(0);
  }

  generate() {
    // Create 2-3 distinct routes of different lengths:
    //   Short route: 2 stations (fast but fewer level-ups)
    //   Medium route: 3-4 stations
    //   Long route: 4-5 stations (more XP/gold but costs more coal)
    // Routes can share some stations, creating decision points

    let id = 0;

    // Start
    const startY = 0.4 + Math.random() * 0.2;
    this.stations.push(new Station(id++, 0.06, startY, STATION_TYPES.START));

    // Exit
    const exitY = 0.35 + Math.random() * 0.3;
    this.stations.push(new Station(id++, 0.94, exitY, STATION_TYPES.EXIT));
    const exitId = 1;

    // Define routes with different lengths
    const numRoutes = 2 + (Math.random() < 0.5 ? 1 : 0); // 2-3 routes
    const routeLengths = [];

    // Always have a short and a long route
    routeLengths.push(2); // short: 2 combat stations
    routeLengths.push(4 + Math.floor(Math.random() * 2)); // long: 4-5 stations

    // Optional medium route
    if (numRoutes === 3) {
      routeLengths.push(3); // medium: 3 stations
    }

    // Sort by length so short is on top, long on bottom
    routeLengths.sort((a, b) => a - b);

    // Generate stations for each route
    const routes = []; // array of arrays of station IDs
    const ySpread = 0.7; // total vertical spread
    const yStart = 0.15; // top margin

    for (let r = 0; r < routeLengths.length; r++) {
      const len = routeLengths[r];
      const route = [];

      // Y band for this route
      const bandY = yStart + (r / Math.max(1, routeLengths.length - 1)) * ySpread;

      for (let s = 0; s < len; s++) {
        // X: evenly spread across the map
        const x = 0.14 + ((s + 0.5) / len) * 0.72;
        // Y: within the route's band with some jitter
        const y = bandY + (Math.random() - 0.5) * 0.15;

        const station = new Station(id++,
          Math.max(0.10, Math.min(0.88, x + (Math.random() - 0.5) * 0.04)),
          Math.max(0.08, Math.min(0.92, y)),
          STATION_TYPES.COMBAT);
        this.stations.push(station);
        route.push(station.id);
      }
      routes.push(route);
    }

    // Connect start to first station of each route
    for (const route of routes) {
      this.addConnection(0, route[0]);
    }

    // Connect stations within each route sequentially
    for (const route of routes) {
      for (let i = 0; i < route.length - 1; i++) {
        this.addConnection(route[i], route[i + 1]);
      }
      // Connect last station of route to exit
      this.addConnection(route[route.length - 1], exitId);
    }

    // Add some cross-connections between routes at similar X positions
    // This creates decision points mid-route
    for (let r = 0; r < routes.length - 1; r++) {
      const routeA = routes[r];
      const routeB = routes[r + 1];

      for (const aId of routeA) {
        const aStation = this.stations[aId];
        for (const bId of routeB) {
          const bStation = this.stations[bId];
          // Connect if X positions are close (within 0.12)
          const xDist = Math.abs(aStation.x - bStation.x);
          if (xDist < 0.12 && Math.random() < 0.35) {
            this.addConnection(aId, bId);
          }
        }
      }
    }

    // Occasionally add an empty/rest station on the long route
    if (routes.length >= 2) {
      const longRoute = routes[routes.length - 1];
      if (longRoute.length >= 4 && Math.random() < 0.6) {
        const restIdx = 1 + Math.floor(Math.random() * (longRoute.length - 2));
        this.stations[longRoute[restIdx]].type = STATION_TYPES.EMPTY;
      }
    }
  }

  addConnection(a, b) {
    if (!this.stations[a].connections.includes(b)) {
      this.stations[a].connections.push(b);
    }
    if (!this.stations[b].connections.includes(a)) {
      this.stations[b].connections.push(a);
    }
  }

  canTravelTo(stationId) {
    const current = this.stations[this.currentStation];
    return current.connections.includes(stationId) && this.coal >= COAL_PER_HOP;
  }

  travelTo(stationId) {
    if (!this.canTravelTo(stationId)) return false;
    this.coal -= COAL_PER_HOP;
    this.currentStation = stationId;
    this.stations[stationId].visited = true;
    this.stationsVisited++;
    this.revealAdjacent(stationId);

    if (this.stations[stationId].type === STATION_TYPES.EXIT) {
      this.completed = true;
    }
    if (this.coal <= 0 && !this.completed) {
      // Check if we can still reach exit — simplified: just flag it
      const canReach = this.stations[stationId].connections.some(
        id => this.stations[id].type === STATION_TYPES.EXIT
      );
      if (!canReach) this.failed = true;
    }
    return true;
  }

  revealAdjacent(stationId) {
    for (const nid of this.stations[stationId].connections) {
      this.stations[nid].revealed = true;
    }
  }

  addCoal(amount) {
    this.coal = Math.min(this.coal + amount, this.maxCoal);
  }

  get currentStationData() {
    return this.stations[this.currentStation];
  }
}
