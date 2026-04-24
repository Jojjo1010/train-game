# Train Defense — Game Design Reference

A browser-based top-down train defense game. A steam locomotive hauls medical supplies to Eastport through hostile wasteland. Man your weapons, hold off waves of enemies, fight off bandits, and survive long enough to deliver.

**Win text:** "The supplies reached Eastport."
**Loss text:** "The train never arrived."

---

## Running locally

Requires a local server for ES modules:

```
cd train-game && python3 -m http.server 8080
```

Open http://localhost:8080

---

## Core loop

1. **Zone map** — navigate a procedurally generated graph of stations. Each hop costs 1 coal.
2. **Setup** — assign crew to weapon mounts or the driver seat before departing.
3. **Combat run** — survive to 10,000 distance units. Defend against enemy waves and bandit boarders, collect coins, gain XP.
4. **Level-up** — on level-up, choose one of three upgrades (weapon, defense, or repair card).
5. **Zone exit** — reach the exit station to complete the zone. After 3 zones, the world is won.
6. **Shop** — between zones, spend accumulated gold on persistent upgrades.

---

## Train layout

```
[Rear Weapons] [Cargo] [Front Weapons] [Locomotive]
```

- **4 cars** total. Each weapon car has 4 mounts (2 top, 2 bottom).
- **8 weapon mounts** total. Each mount has a directional firing cone (±45°).
- **Driver seat** in the locomotive: +50% weapon damage to all weapons when manned.
- **Cargo car** is the primary enemy target (70% of enemy spawns target it).

---

## Crew system

The train starts with 2 crew members: **Rex** and **Kit**. Both are available from the start — no unlock required.

### Crew roles (chosen per world)

Before entering each world, the player picks a **role** for each crew member in the "CHOOSE YOUR CREW" screen. Both crew can share the same role.

| Role    | Weapon              | Bonus |
|---------|---------------------|-------|
| Gunner  | Manual gun          | ×1.6 gun damage |
| Brawler | Garlic AOE (no gun) | Instantly kicks bandits off with AOE damage; no manual projectiles |

Roles reset between worlds. A Brawler crew member cannot fire projectiles — instead they project a garlic aura that damages all nearby enemies on a tick.

**Stationed** means assigned to a slot and not currently walking between cars.

### Crew movement

During combat, crew walk along the train between cars. Movement is animated — crew pass through doors with a brief pause (0.55s per door). If an auto-weapon mount is vacated and the crew member is idle there after defeating a bandit, a hint banner appears.

### Crew placement rules

- Crew can occupy any weapon mount or the driver seat.
- Crew cannot be placed on a mount that has an auto-weapon installed (except to fight a bandit who jumped there).
- Left-click to select, right-click to assign to a slot. Works in both setup and run phases.
- Selected crew's weapon follows the mouse during combat.

---

## Weapons

### Manual weapons (crew-operated)

Only **Gunner** crew fire manual guns. **Brawler** crew use a garlic AOE instead (see Crew roles above). Each crew member's gun upgrades independently (levels 1–5 via level-up cards).

| Stat at Lv1 | Value |
|-------------|-------|
| Damage      | 12    |
| Fire rate   | 2/s   |
| Range       | 220   |

Growth per level: +5 damage, +0.6/s fire rate, +15 range.

- **Gunner bonus:** ×1.6 damage on top of all other multipliers.
- **Driver seat:** No damage bonus (driver does not operate a weapon mount).
- Mounts auto-target the nearest enemy in range. When a crew member is selected, the mount fires toward the mouse cursor within its cone.

### Auto-weapons (level-up unlocks, max 2 equipped)

Auto-weapons are gained via level-up cards and placed on empty mounts. Up to 2 can be active at once. They fire independently of crew.

| Weapon       | Description                                        | Max level |
|--------------|-----------------------------------------------------|-----------|
| Turret       | Targets nearest enemy, fires bursts                | 5         |
| Auto Laser   | Single projectile at nearest enemy, no cone limit  | 5         |
| Laser        | Bouncing bolt that chains between enemies          | 5         |

- A bandit landing on an auto-weapon mount disables that weapon until the bandit is defeated.

---

## Enemy wave system

Enemy spawning follows a **CALM → WARNING → SURGE** cycle. Each full cycle is ~13 seconds.

| Phase   | Duration | Spawn rate       | HUD indicator                          |
|---------|----------|------------------|----------------------------------------|
| CALM    | 5s       | ×0.5             | None                                   |
| WARNING | 3s       | Normal           | Pulsing red banner: "WAVE N INCOMING"  |
| SURGE   | 5s       | ×2.0 (×3.5 at boss stations) | Red screen-edge vignette, surge banner |

Wave number increments on each SURGE start. Each successive wave escalates by ×1.15 per wave on top of base difficulty. During a surge, additional enemies are spawned per tick based on wave number.

### Thematic wave labels

Wave announcements use narrative text rather than generic numbers:

| Waves  | Warning text              | Surge text         |
|--------|---------------------------|--------------------|
| 1–2    | "Scouts approaching"      | "Scout party"      |
| 3–4    | "Raiding party incoming"  | "Under attack"     |
| 5–6    | "The horde approaches"    | "Horde assault"    |
| 7+     | "The horde has found you" | "Overwhelming force" |

### Enemy tiers

Difficulty tier is determined by zone depth (`distance / target_distance`).

| Tier | Name      | Radius mult | HP mult |
|------|-----------|-------------|---------|
| 0    | Scavenger | ×1.5        | ×1      |
| 1    | Raider    | ×5          | ×4      |
| 2    | War Rig   | ×5          | ×6      |

Enemies spawn from all four screen edges: top (30%), bottom (30%), behind/left (25%), ahead/right (15%).

Target priority: 70% cargo car, 15% rear weapons, 15% front weapons.

---

## Bandits

Bandits are a separate threat from enemy waves. They spawn from off-screen and run alongside the train, then jump onto unmanned weapon mounts.

**Behavior states:** RUNNING → JUMPING → ON_TRAIN → FIGHTING → DEAD

- **Targeting:** Bandits only jump onto mounts with no crew currently stationed.
- **On a mount:** Disables that weapon slot. Gold stealing is disabled (steal rate = 0).
- **On an auto-weapon mount:** The auto-weapon is disabled for as long as the bandit is there.
- **Defeated:** Move crew to the bandit's slot. What happens depends on the crew role:
  - **Gunner:** 0.5s fight then bandit is kicked off.
  - **Brawler:** Bandit is instantly kicked with AOE damage (60 damage, 160px radius).
- **Spawn rate:** Every ~12s (scales down with difficulty, minimum 3s).
- **Alert banner:** Pulsing red banner appears at the top while any bandit is on the train.

---

## Coins

- Coins spawn in the world at 3-second intervals and drift toward the train.
- Coins can also be knocked into collection by projectile hits.
- Collected coins fly to the gold HUD indicator (top-right).
- Coin value: 10 gold each. Greed upgrade increases yield.
- Max 30 world coins + 30 flying coins active simultaneously.

---

## Progression systems

### XP and level-ups

- 12 XP per enemy kill.
- XP to next level = current level × 80.
- On level-up, game pauses and presents 3 cards (shuffled from eligible options).

**Card types:**
- **Crew gun upgrade** — upgrades a specific crew member's gun (per-crew, levels 1–5)
- **New auto-weapon** — unlocks Turret, Steam Blast, or Laser; requires empty mount (triggers mount-select screen)
- **Upgrade auto-weapon** — levels up an already-equipped auto-weapon
- **Defense — Shield** — reduces incoming damage per hit (-2 per level, max 5)
- **Defense — Regen** — +3 HP/s hull regen per level (max 5)
- **Defense — Repair** — instant +30 HP (no slot cost, always available)

Defense cards (Shield and Regen) occupy defense slots (max 2 equipped defenses at once). Repair never takes a slot.

### Cargo boxes

Start with 4 cargo boxes. Win bonus = `runGold × (1 + boxes × 0.25)`. At 4 boxes: ×2 multiplier.

### Coal (fuel)

- Coal is spent to move between stations on the zone map (1 coal per hop).
- Start each world with 4 coal, max 8.
- Earn 2 coal per combat victory.
- Buy 2 coal for 30 gold at the shop.
- Stranded with no coal and no path to exit = run over.

---

## Persistent shop upgrades

Persist across worlds. Flat cost per level (not scaling).

| Upgrade    | Cost/level | Max level | Effect per level                     |
|------------|-----------|-----------|--------------------------------------|
| Damage     | 40        | 5         | +15% weapon damage                   |
| Kick Force | 40        | 5         | Increases Brawler kick damage/radius |
| Max HP     | 30        | 5         | +25 max HP                           |

---

## Zone map

Each zone generates a graph of stations:
- **Start** — entry point, free.
- **Combat** — triggers a combat run.
- **Empty** — rest stop, no combat. 1s arrival pause then returns to map.
- **Exit** — clears the zone and awards `stations_visited × 25 gold`.

**Route generation:** 2–3 routes of varying length (short: 2 stations, medium: 3, long: 4–5). Occasional cross-connections between routes at similar X positions create decision points. Long routes may include one empty station.

**Revelation:** Only stations adjacent to visited stations are shown. Type icons hidden until revealed.

**Boss station:** The combat station directly before the exit. Difficulty ×1.6, surge spawn rate ×3.5.

---

## Game states

`ZONE_MAP → SETUP → RUNNING → LEVELUP → PLACE_WEAPON → GAMEOVER → SHOP`

- **PAUSED** — accessible from SETUP, RUNNING, or LEVELUP via Escape. Includes volume sliders.
- **SETTINGS** — accessible from zone map. Volume sliders + debug hitbox toggle.
- **PLACE_WEAPON** — entered after selecting a new auto-weapon card; click an empty mount to install.

---

## Technical notes

- Canvas: 960×640 (UI overlay) + Three.js WebGL layer beneath (isometric 3D train model).
- Train sits at 30% from left edge of canvas (`CAMERA_TRAIN_X`).
- Object pools: 150 enemies, 300 projectiles, 10 ricochet bolts, 80 damage numbers, 30 coins, 30 flying coins, 10 bandits.
- All tuning constants overridable via `window.__tuning` (set before module init) for live tweaking.
- F3 or Settings menu toggles debug hitbox overlay.
- `dt` is capped at 50ms per frame to prevent large jumps on tab resume.

---

## Key files

| File              | Responsibility                                      |
|-------------------|-----------------------------------------------------|
| `src/constants.js` | All tuning values, weapon definitions, wave config |
| `src/main.js`      | Game state machine, level-up cards, game loop      |
| `src/train.js`     | Train, cars, mounts, crew, driver seat, pathfinding|
| `src/enemies.js`   | Spawner, wave phases, enemy tiers, thematic labels |
| `src/combat.js`    | Projectiles, auto-weapons, collision, XP           |
| `src/bandits.js`   | Bandit state machine, boarding, gold theft         |
| `src/zone.js`      | Zone graph generation, coal, station types         |
| `src/coins.js`     | Coin spawning, magnet collection, flying coins     |
| `src/renderer3d.js`| Three.js scene + 2D HUD overlay, all draw methods |
| `src/audio.js`     | Music and SFX                                       |
