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
    const layers = 2 + Math.floor(Math.random() * 2); // 2-3 layers
    const nodesPerLayer = () => 1 + Math.floor(Math.random() * 2); // 1-2

    let id = 0;

    // Start station (left side, random Y)
    this.stations.push(new Station(id++, 0.06, 0.35 + Math.random() * 0.3, STATION_TYPES.START));

    const layerStations = [];
    for (let l = 0; l < layers; l++) {
      const count = nodesPerLayer();
      const layer = [];
      for (let n = 0; n < count; n++) {
        // X: spread across the layer zone with significant jitter
        const layerX = 0.15 + (l / Math.max(1, layers - 1)) * 0.65;
        const x = layerX + (Math.random() - 0.5) * 0.10;

        // Y: spread across full height with randomness
        const yBase = (n + 0.5) / count;
        const y = yBase + (Math.random() - 0.5) * 0.30;

        const type = STATION_TYPES.COMBAT;

        const station = new Station(id++,
          Math.max(0.08, Math.min(0.88, x)),
          Math.max(0.08, Math.min(0.92, y)),
          type);
        this.stations.push(station);
        layer.push(station.id);
      }
      layerStations.push(layer);
    }

    // Exit station (right side, random Y)
    this.stations.push(new Station(id++, 0.94, 0.3 + Math.random() * 0.4, STATION_TYPES.EXIT));
    const exitId = id - 1;

    // Connect start to first layer
    const firstLayer = layerStations[0];
    for (const nid of firstLayer) {
      this.stations[0].connections.push(nid);
      this.stations[nid].connections.push(0);
    }

    // Connect adjacent layers
    for (let l = 0; l < layerStations.length - 1; l++) {
      const current = layerStations[l];
      const next = layerStations[l + 1];

      // Each node connects to 1-2 nodes in next layer
      for (const cid of current) {
        // Connect to closest node in next layer
        const cStation = this.stations[cid];
        const sorted = [...next].sort((a, b) => {
          return Math.abs(this.stations[a].y - cStation.y) - Math.abs(this.stations[b].y - cStation.y);
        });
        // Always connect to closest
        this.addConnection(cid, sorted[0]);
        // 60% chance to also connect to second closest
        if (sorted.length > 1 && Math.random() < 0.6) {
          this.addConnection(cid, sorted[1]);
        }
      }

      // Ensure every node in next layer has at least one connection
      for (const nid of next) {
        const hasIncoming = current.some(cid => this.stations[cid].connections.includes(nid));
        if (!hasIncoming) {
          // Connect to closest in current layer
          const nStation = this.stations[nid];
          const closest = current.reduce((best, cid) => {
            const dist = Math.abs(this.stations[cid].y - nStation.y);
            return dist < best.dist ? { id: cid, dist } : best;
          }, { id: current[0], dist: Infinity });
          this.addConnection(closest.id, nid);
        }
      }
    }

    // Connect last layer to exit
    const lastLayer = layerStations[layerStations.length - 1];
    for (const nid of lastLayer) {
      this.addConnection(nid, exitId);
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
