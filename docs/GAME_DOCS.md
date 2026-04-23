# Train Defense — Game Documentation

Complete reference for game mechanics, systems, UI, and flow.

---

## 1. Game Overview

**Genre:** Top-down tower defense / survivor hybrid with roguelite progression.

**Core Fantasy:** Defend a moving train across hostile wastelands by manning weapons, managing crew, and upgrading between encounters.

**Camera:** Side-scrolling 2D overlay on a 3D scene. The train sits at 30% from the left of a 960x640 canvas. Enemies approach from the right and above/below.

**Core Loop (per combat encounter):**
1. SETUP — assign crew to weapon mounts and driver seat
2. RUNNING — enemies spawn in waves; shoot, collect coins, fight bandits
3. LEVEL UP — choose upgrade cards when XP threshold is reached
4. Reach TARGET_DISTANCE (10,000 units) to win the encounter

**Meta Loop (across runs):**
1. Select a world on the world map
2. Navigate a procedural zone map, spending coal to hop between stations
3. Fight at combat stations, collect gold
4. Complete 3 zones to beat a world
5. Spend persistent gold in the shop between worlds

---

## 2. Game States & Flow

The game uses 13 discrete states (indexed 0-12):

| Index | State          | Description |
|-------|----------------|-------------|
| 0     | `ZONE_MAP`     | Navigate the procedural station graph |
| 1     | `SETUP`        | Pre-combat crew/weapon assignment |
| 2     | `RUNNING`      | Active combat gameplay |
| 3     | `LEVELUP`      | Choose 1 of 3 upgrade cards |
| 4     | `PLACE_WEAPON` | Click a mount to install a new auto-weapon |
| 5     | `GAMEOVER`     | Death screen |
| 6     | `PAUSED`       | Pause menu (resume / restart / quit) |
| 7     | `SHOP`         | Persistent upgrade shop |
| 8     | `SETTINGS`     | Volume sliders (music / SFX) |
| 9     | `START_SCREEN` | Title screen with 3D train model |
| 10    | `WORLD_SELECT` | Choose which world to enter |
| 11    | `WORLD_MAP`    | World-level overview after completing a zone |
| 12    | `RUN_PAUSE`    | Tactical pause during combat (can aim weapons) |

### Transition Diagram

```
START_SCREEN ──┬──> WORLD_SELECT ──> ZONE_MAP ──> SETUP ──> RUNNING
               ├──> SHOP ──> START_SCREEN                    │  │  │
               └──> SETTINGS ──> START_SCREEN                │  │  │
                                                             │  │  │
                     ┌───────────────────────────────────────┘  │  │
                     v                                          │  │
                  LEVELUP ──> PLACE_WEAPON ──> RUNNING          │  │
                  LEVELUP ──> RUNNING                           │  │
                     ┌──────────────────────────────────────────┘  │
                     v                                             │
                  RUN_PAUSE ──> RUNNING                            │
                  PAUSED ──> RUNNING / SETUP / START_SCREEN        │
                     ┌─────────────────────────────────────────────┘
                     v
                  Combat Win ──> ZONE_MAP ──> ... ──> WORLD_MAP ──> ZONE_MAP / START_SCREEN
                  Death ──> GAMEOVER ──> START_SCREEN
```

---

## 3. Start Screen

- **Title:** Static golden title text ("TRAIN DEFENSE") with glow
- **Gold display:** Persistent gold shown above the menu buttons
- **3D Train Model:** Actual 3D train mesh slowly rotating, visible through semi-transparent overlay with vignette. All other gameplay objects (enemies, mounts, rails) hidden.
- **Buttons:** 3 vertically stacked golden buttons:
  1. **Start Game** — enters WORLD_SELECT
  2. **Power Ups** — enters SHOP
  3. **Settings** — enters SETTINGS
- No subtitle text
- No dust particles

---

## 4. The Train

### Car Layout (left to right)

| Index | Type         | Contents |
|-------|--------------|----------|
| 0     | Weapon Car   | 4 weapon mounts at corners |
| 1     | Cargo Car    | Cargo boxes (gold multiplier) |
| 2     | Weapon Car   | 4 weapon mounts at corners |
| 3     | Locomotive   | Driver seat (center) |

### Dimensions

```
CAR_WIDTH   = 32 px
CAR_HEIGHT  = 14 px
CAR_GAP     = 6 px
Total train width = 4 * 32 + 3 * 6 = 146 px
```

### HP System

- **Base Max HP:** 150
- **Shop bonus:** +25 HP per Max Hull upgrade level
- HP persists between encounters within a world (healed only by Regen or Repair)
- **Damage flash** and **HP flash** visual feedback on hit
- **Screen shake** on damage

### Cargo Multiplier

```
cargoMultiplier = 1.0 + cargoBoxes * 0.25
```

Starting cargo boxes: 4 (so starting multiplier = 2.0x). Applies to gold earned from coins.

---

## 5. Crew System

### Crew Members

| ID | Name | Color |
|----|------|-------|
| 0  | Rex  | Red   |
| 1  | Kit  | Blue  |

- Start with **2 crew members** (Rex and Kit). Max 2 crew — no additional unlocks.
- Colors: `#e74c3c` (red), `#3498db` (blue)
- Rosa (green) has been removed from the game.

### Crew Roles

Before entering each world, players choose a **role** for each crew member in the "CHOOSE YOUR CREW" UI. Roles are picked per-world (reset between worlds). Both crew can have the same role (e.g. 2 Brawlers).

| Role    | Gun? | Bonus |
|---------|------|-------|
| **Gunner**  | Yes | +60% gun damage (`GUNNER_DAMAGE_MULT = 1.6`). 2x bandit fight duration. |
| **Brawler** | No  | No manual gun. Has garlic AOE weapon instead (see Section 5.1). Instantly kicks bandits off with AOE landing damage. |

The role selection screen ("CHOOSE YOUR CREW") appears after world selection, before entering the world map.

### Movement

Crew physically walk between mounts/seats through the train:

```
CREW_WALK_SPEED = 120 px/sec
DOOR_PAUSE      = 0.35 sec (delay when passing through a door between cars)
```

- Movement follows waypoints along the train with pauses at doors
- Doors visually open/close as crew pass through
- Each car has a right-side door connecting to the next car

### 5.1 Brawler Garlic AOE Weapon

Brawler crew do not fire a manual gun. Instead, they project a garlic aura that damages all nearby enemies continuously.

```
GARLIC_RADIUS      = 50 px
GARLIC_DAMAGE      = 14 per tick
GARLIC_TICK_RATE   = 0.4s
GARLIC_KNOCKBACK   = 200 (impulse per tick)
```

- Enemies within radius are damaged every 0.4s and knocked back (200 strength).
- Hit sparks appear on each tick for visual feedback.
- A 3D aura ring (using the Garlic model) is displayed around the Brawler's mount to show the damage area. One ring per Brawler.
- No 3D weapon model is shown on the mount itself.
- No projectiles are fired.

### Driver Seat

Located at the center of the locomotive (car index 3). A crew member in the driver seat provides:

```
DRIVER_DAMAGE_BUFF = 1.0x (no damage bonus)
```

The driver does not operate a weapon mount.

---

## 6. Weapon Mounts

### Layout

Each weapon car has 4 mounts positioned at the corners:

```
Mount offset from car edge: MOUNT_RADIUS + 2 = 10 px
```

| Position     | Base Direction        | Cone |
|--------------|----------------------|------|
| Top-left     | -135 deg (up-left)    | 180 deg total (manual) / 90 deg (auto) |
| Top-right    | -45 deg (up-right)    | 180 deg total (manual) / 90 deg (auto) |
| Bottom-left  | +135 deg (down-left)  | 180 deg total (manual) / 90 deg (auto) |
| Bottom-right | +45 deg (down-right)  | 180 deg total (manual) / 90 deg (auto) |

**Total mounts:** 8 (4 per weapon car)

### Mount States

| State         | Description |
|---------------|-------------|
| **Crew**      | Manned by a crew member — fires manual weapon |
| **Auto**      | Has an installed auto-weapon — fires automatically |
| **Bandit**    | Occupied by a bandit — weapon disabled, gold being stolen |
| **Empty**     | Unoccupied — no weapon fires |

A mount can hold either a crew member OR an auto-weapon, never both.

**Unmanned mounts do not auto-fire.** Only mounts with a crew member or an installed auto-weapon will shoot.

---

## 7. Manual Weapons (Crew Guns)

Each crew member has a personal weapon that levels up independently.

### Level Scaling

| Level | Damage | Fire Rate | DPS  | Range |
|-------|--------|-----------|------|-------|
| 1     | 12     | 2.0/s     | 24   | 220   |
| 2     | 17     | 2.6/s     | 44   | 235   |
| 3     | 22     | 3.2/s     | 70   | 250   |
| 4     | 27     | 3.8/s     | 103  | 265   |
| 5     | 32     | 4.4/s     | 141  | 280   |

```
Damage per level:    +5
Fire rate per level: +0.6/s
Range per level:     +15
```

### Aiming

Applies to **Gunner** crew only. Brawler crew do not fire projectiles (see Section 5.1).

- **Selected crew (Gunner):** Weapon aims toward mouse cursor, clamped to a screen-space cone angle
- **Unselected crew (Gunner):** Auto-targets nearest enemy within range and cone
- **Keyboard aiming:** WASD / Arrow keys rotate weapon direction at 2.5 rad/sec
- Cone angle clamped to `baseDirection +/- 90 deg` (180 deg total arc)
- Damage is multiplied by `GUNNER_DAMAGE_MULT = 1.6`

### Projectiles

```
PROJECTILE_SPEED    = 350 px/sec
PROJECTILE_LIFETIME = 2 sec
PROJECTILE_RADIUS   = 3 px
```

---

## 8. Auto-Weapons

Gained via level-up cards (not selected at start). **Maximum 2 auto-weapons** equipped at a time. Each must be placed on a weapon mount.

### Turret

Burst-fire projectile weapon that auto-targets nearest enemy.

| Level | Shots/Burst | Damage | Fire Interval | Range |
|-------|-------------|--------|---------------|-------|
| 1     | 1           | 10     | 1.2s          | 250   |
| 2     | 2           | 12     | 1.1s          | 270   |
| 3     | 3           | 14     | 1.0s          | 290   |
| 4     | 4           | 16     | 0.9s          | 310   |
| 5     | 5           | 18     | 0.8s          | 330   |

### Auto Laser

Fires projectiles at the nearest enemy. No cone restriction — targets freely. Uses the Garlic 3D model for its mount visuals.

| Level | Damage | Fire Interval | Range |
|-------|--------|---------------|-------|
| 1     | 10     | 1.4s          | 240   |
| 2     | 13     | 1.25s         | 260   |
| 3     | 16     | 1.1s          | 280   |
| 4     | 19     | 0.95s         | 300   |
| 5     | 22     | 0.8s          | 320   |

```
Damage per level:        +3
Fire interval per level: -0.15s (minimum 0.3s)
Range per level:         +20
```

### Laser (Ricochet Shot)

Fires a bolt that bounces between enemies.

| Level | Bounces | Damage | Fire Interval | Speed |
|-------|---------|--------|---------------|-------|
| 1     | 2       | 8      | 2.5s          | 300   |
| 2     | 3       | 11     | 2.2s          | 325   |
| 3     | 4       | 14     | 1.9s          | 350   |
| 4     | 5       | 17     | 1.6s          | 375   |
| 5     | 6       | 20     | 1.3s          | 400   |

**Note:** Steam Blast has been removed from the game.

Auto-weapons use a narrower cone: **90 deg total** (vs 180 deg for manual). The Auto Laser has no cone restriction.

---

## 9. Defense Slots

Gained via level-up cards. **Maximum 2 defense slots** (Shield and Regen take slots; Repair does not).

| Defense    | Per Level       | Max Level | Slot Cost |
|------------|-----------------|-----------|-----------|
| **Shield** | -2 damage/hit   | 5         | 1 slot    |
| **Regen**  | +3 HP/sec       | 5         | 1 slot    |
| **Repair** | Instant +30 HP  | 1 (consumable) | No slot |

---

## 10. Enemies

### Base Stats

```
ENEMY_BASE_HP        = 20
ENEMY_BASE_SPEED     = 50 px/sec
ENEMY_RADIUS         = 6 px
ENEMY_CONTACT_DAMAGE = 8
```

### Tiers

| Tier | Name       | Color  | Radius Mult | HP Mult | Effective HP | Effective Radius |
|------|------------|--------|-------------|---------|-------------|-----------------|
| 0    | Scavenger  | Purple | 1.5x        | 1.0x    | 20          | 9               |
| 1    | Raider     | Red    | 5.0x        | 4.0x    | 80          | 30              |
| 2    | War Rig    | Dark   | 5.0x        | 6.0x    | 120         | 30              |

### Kind Split

- **60% Zombie** — standard melee approach
- **40% Bug** — same behavior, different visual

### Behavior

Enemies spawn off-screen and path toward the nearest point on the train bounding box. On contact, they deal `ENEMY_CONTACT_DAMAGE` per hit.

**Knockback:** On hit, enemies receive an impulse of 80 units in the projectile's travel direction, decaying at rate 12/sec.

---

## 11. Wave System

Combat encounters use a repeating wave cycle:

### Phase Cycle

```
CALM (5s) ──> WARNING (3s) ──> SURGE (5s) ──> CALM ...
```

| Phase     | Duration | Spawn Multiplier | Description |
|-----------|----------|-------------------|-------------|
| **CALM**  | 5s       | 0.5x              | Reduced spawning, collect coins, reposition crew |
| **WARNING** | 3s     | Normal             | "Scouts approaching" text, directional indicator |
| **SURGE** | 5s       | 2.0x              | Intense spawning from indicated direction |

Full cycle duration: 12 seconds (excluding warning overlap).

### Wave Escalation

```
Difficulty per wave = baseRate * (1 + waveNumber * 0.10)
```

Each successive wave increases spawn rate and can introduce higher-tier enemies.

### Spawn Direction

- Waves 1-2: Always from the **right** (tutorial)
- Wave 3+: Weighted random — right (30%), top (25%), bottom (25%), both sides (20%)

### Boss Stations

Boss stations use an amplified surge multiplier of **3.5x** instead of the normal 2.0x.

### Station Combat Modifiers

Applied to specific stations on the zone map:

| Modifier    | Spawn Mult | HP Mult | Coin Mult | Gold Mult | Color   |
|-------------|-----------|---------|-----------|-----------|---------|
| **Swarm**   | 2.0x      | 0.5x    | 1.0x      | 1.0x      | Red     |
| **Armored** | 0.5x      | 2.5x    | 1.0x      | 1.0x      | Blue    |
| **Ambush**  | 1.5x      | 1.0x    | 1.0x      | 1.0x      | Orange  |
| **Bounty**  | 1.0x      | 1.0x    | 2.0x      | 1.0x      | Gold    |
| **Gauntlet**| 1.5x      | 1.5x    | 1.0x      | 1.5x      | Purple  |

### Wave Labels

| Wave  | Warning Text            | Surge Text          |
|-------|------------------------|---------------------|
| 1-2   | "Scouts approaching"    | "Scout party"       |
| 3-4   | "Raiding party incoming" | "Under attack"     |
| 5-6   | "The horde approaches"  | "Horde assault"     |
| 7+    | "The horde has found you" | "Overwhelming force" |

---

## 12. Bandits

Bandits are a separate threat from enemies. They board the train and occupy weapon mounts, disabling the weapon.

### States

```
RUNNING ──> JUMPING ──> ON_TRAIN ──> FIGHTING ──> DEAD
```

| State      | Description |
|------------|-------------|
| **RUNNING**  | Approaches train from off-screen, running alongside at ~110 px/sec |
| **JUMPING**  | Leaps onto targeted mount (0.4s duration) |
| **ON_TRAIN** | Sits on weapon mount, disabling the weapon |
| **FIGHTING** | Crew member arrived — brief scuffle (0.5s) |
| **DEAD**     | Kicked off the train, death animation |

### Stealing

```
BANDIT_STEAL_RATE = 0 gold/sec (currently disabled)
```

Gold stealing is disabled. Bandits occupy weapon mounts, disabling the weapon, but do not drain gold.

### Spawn Timing

```
BANDIT_SPAWN_INTERVAL = 12 sec (base, decreases with difficulty, minimum 3s)
MAX_BANDITS           = 10 simultaneous
```

### Defeating Bandits

When a crew member is assigned to a mount occupied by a bandit, the crew walks to that mount. What happens on arrival depends on the crew member's **role**:

**Gunner:**
- A fight plays out over `BANDIT_FIGHT_DURATION` (2x the base duration — Gunner has 2x fight time).

**Brawler:**
- The bandit is **instantly kicked** — no fight duration.
- The bandit flies toward the nearest enemy cluster (up to 100 px away, 0.4s flight).
- On landing: AOE damage centered on the landing point.
  ```
  BRAWLER_KICK_DAMAGE = 60
  BRAWLER_KICK_RADIUS = 160
  ```
- A **shockwave visual** plays at both the kick origin and the landing point.
- The bandit fades out after landing (0.3s fade).

### First-Boarding Tooltip

The first time a bandit boards in a run, a tooltip appears for 3 seconds explaining the mechanic.

---

## 13. Coins & Economy

### Coin Spawning

```
COIN_SPAWN_INTERVAL = 3 sec
COIN_VALUE          = 10 gold
COIN_RADIUS         = 8 px
MAX_COINS           = 30 on screen
```

Coins spawn at random positions within the play area.

### Collection

Coins are collected by clicking or by **magnets** (8% chance spawn). A magnet collects all coins on screen instantly.

### Flying Coin Animation

When collected, coins animate as a flying coin from their world position to the gold HUD counter:

```
COIN_FLY_SPEED = 400 px/sec (accelerates as it nears target)
MAX_FLYING_COINS = 30
```

### Gold Multiplier

Final gold value per coin:

```
goldEarned = COIN_VALUE * cargoMultiplier * modifier.coinMult
```

Where:
- `cargoMultiplier` = 1.0 + cargoBoxes * 0.25 (default 2.0x)
- `modifier.coinMult` = station modifier bonus (Bounty = 2.0x)

### Station Gold Reward

Each station win grants a flat `GOLD_PER_STATION = 25` gold.

---

## 14. Level-Up System

### XP

```
XP_PER_KILL  = 12
XP to next   = currentLevel * XP_PER_LEVEL
XP_PER_LEVEL = 80
```

So level 1 requires 80 XP (about 7 kills), level 2 requires 160 XP, etc.

### Card Selection

On level-up, the game pauses and presents **3 random cards** drawn from the pool:

| Card Type          | Effect |
|--------------------|--------|
| Manual Gun Upgrade | Increase a Gunner crew member's weapon level |
| New Auto-Weapon    | Acquire Turret, Auto Laser, or Laser (Ricochet) (then place on mount) |
| Auto-Weapon Upgrade| Level up an existing auto-weapon |
| Shield (new/upgrade)| Add or upgrade Shield defense |
| Regen (new/upgrade)| Add or upgrade Regen defense |
| Repair             | Instant +30 HP (always available, no slot) |

Cards are shuffled randomly. New auto-weapons trigger the `PLACE_WEAPON` state where the player clicks a mount to install it. A **weapon acquisition fanfare** plays with a freeze-frame effect.

---

## 15. Zones & World Map

### Worlds

| World | Name          | Subtitle                  | Difficulty | Color   | Stars |
|-------|---------------|---------------------------|-----------|---------|-------|
| 1     | The Dustlands | Arid plains crossing       | 1.0x      | Sand    | 1     |
| 2     | Iron Wastes   | Ruined industrial badlands | 1.5x      | Steel   | 2     |
| 3     | The Inferno   | Volcanic hellscape         | 2.0x      | Crimson | 3     |

Each world contains **3 zones** (`ZONES_PER_WORLD = 3`). Zone difficulty scales within a world:

```
zoneDifficulty = worldDifficulty + zoneNumber * ZONE_DIFFICULTY_SCALE (0.2)
```

### Zone Map (Procedural Station Graph)

Each zone generates a graph of stations with 2-3 routes of varying length:

- **Short route:** 2 combat stations (fast, fewer level-ups)
- **Medium route:** 3 stations (balanced)
- **Long route:** 4-5 stations (more XP/gold, costs more coal)

Routes may share stations, creating decision points.

### Station Types

| Type     | Description |
|----------|-------------|
| `START`  | Entry point. Always station 0. |
| `COMBAT` | Enemy encounter with optional modifier |
| `EMPTY`  | No combat. Safe passage. |
| `EXIT`   | Zone complete when reached |

Stations have a **fog of war**: only stations adjacent to visited nodes are revealed.

### Coal System

```
Coal per hop:   1
Coal per win:   +2
Starting coal:  4
Max coal:       8
```

Each move on the zone map costs 1 coal. Winning a combat station grants +2 coal. If you run out of coal, you cannot move.

**Coal Shop:** Available in the shop — spend 30 gold for +2 coal.

---

## 16. Shop & Persistent Upgrades

The shop is accessible from the start screen. Gold is persistent across runs and worlds.

### Upgrades

| Upgrade        | Cost/Level | Max Level | Per Level          |
|----------------|-----------|-----------|---------------------|
| **Damage**     | 40        | 5         | +15% weapon damage  |
| **Kick Force** | 40        | 5         | Increases Brawler kick AOE damage/radius |
| **Max HP**     | 30        | 5         | +25 max HP          |

### Persistence

- **Kept on death:** Persistent gold, shop upgrades
- **Lost on death:** Run gold (gold earned during the current encounter)
- Shop upgrades are applied at the start of every combat encounter via `applyShopUpgrades()`

---

## 17. Combat Mechanics

### Projectile Pool

```
MAX_PROJECTILES     = 300
MAX_RICOCHET_BOLTS  = 10
MAX_DAMAGE_NUMBERS  = 80
```

Pre-allocated object pools to avoid garbage collection during combat.

### Hit Detection

Circle-circle collision between projectile radius (3) and enemy radius (varies by tier).

### Knockback

On hit (non-lethal):

```
KNOCKBACK_STRENGTH = 80 (impulse in projectile direction)
KNOCKBACK_DECAY    = 12/sec (exponential)
```

### Damage Numbers

Floating numbers appear at hit location, rising and fading. Pool of 80 recycled instances. Displayed damage is **capped at the enemy's remaining HP** (no overkill numbers).

### Hitstop

On enemy kill: a **2-frame freeze** (`hitStopTimer`) creates a micro-pause for impact feel.

### Hidden Mechanics

These mechanics are invisible to the player (no UI indication) but affect gameplay:

**Last-Stand Forgiveness:** When train HP drops below 15%, incoming damage is reduced by 30% for 3 seconds. This gives players a brief window to recover. The timer resets if HP is still below 15% when it expires.

```
Threshold:        15% of max HP
Damage reduction: -30% (multiplier 0.7)
Duration:         3 seconds
```

**Buddy Bonus:** When two crew members are on adjacent mounts (same weapon car), both deal +15% damage. This rewards clustering crew on the same car rather than spreading them across both weapon cars.

```
Bonus:     +15% damage (multiplier 1.15)
Condition: Another crewed mount exists on the same car
```

### Screen Shake

Triggered by:
- Train taking damage
- Wave surge beginning
- Other high-impact events

Uses `train.shakeTimer` to offset rendering.

### Damage Flash

Enemies flash white for 0.05s when hit. The train flashes on damage.

---

## 18. Audio

### Dual Volume Buses

Two independent volume controls, persisted to `localStorage`:

- **Music bus** — background music
- **SFX bus** — all sound effects

Both route through a master gain node.

### Synthesized SFX

Generated at runtime using Web Audio API oscillators and noise buffers:

| Sound            | Description |
|------------------|-------------|
| `playShoot()`    | 3-layer: noise snap (15ms) + low thump (120Hz sine) + pitch sweep (square wave) |
| `playEnemyHit()` | Impact feedback |
| `playEnemyKill()`| Kill confirmation |
| `playWaveClear()` | Wave cleared jingle |
| `playTrainDamage()` | Train hit warning |
| `playPowerup()`  | Upgrade acquired |
| `playWeaponAcquire()` | New weapon fanfare |

### MP3 Files

Pre-loaded audio assets:

| Sound               | Trigger |
|----------------------|---------|
| Coin pickup          | Coin collected |
| Steal                | Bandit stealing gold |
| Level up             | XP threshold reached |
| Zone complete        | EXIT station reached |
| Win world            | All 3 zones cleared |
| Defeat               | Train HP reaches 0 |
| Music                | Background loop during gameplay |

---

## 19. Input & Controls

### Mouse

- **Click crew member** — select for direct control
- **Click weapon mount** — assign selected crew to that mount
- **Click driver seat** — assign selected crew to drive
- **Mouse aim** — selected crew's weapon tracks cursor
- **Click coin** — collect coin
- **Click mount (PLACE_WEAPON)** — install new auto-weapon

### Keyboard

| Key           | State    | Action |
|---------------|----------|--------|
| `1`, `2`, `3` | RUNNING, SETUP | Select crew member by index |
| `Tab`         | SETUP, RUNNING, RUN_PAUSE | Cycle crew selection |
| `W/A/S/D`     | RUNNING  | Rotate selected weapon aim direction |
| Arrow keys    | RUNNING  | Rotate selected weapon aim direction |
| `Escape`      | RUNNING  | Open pause menu |
| `Space`       | RUNNING  | Tactical pause (RUN_PAUSE) |
| `Space`       | RUN_PAUSE | Resume gameplay |
| `D`           | ZONE_MAP | Debug mode toggle |

### Controls Legend

A controls legend (key bindings reference) is displayed on the left side of the screen during runs.

### State-Specific Controls

| State        | Available Actions |
|--------------|-------------------|
| `START_SCREEN` | Click Start Game, Power Ups, Settings |
| `SETUP`      | Assign crew, click Depart to begin combat |
| `RUNNING`    | Aim, shoot, select crew, collect coins, tactical pause |
| `RUN_PAUSE`  | Aim weapons, reassign crew (time frozen) |
| `ZONE_MAP`   | Click connected stations to travel |
| `LEVELUP`    | Click one of 3 upgrade cards |
| `SHOP`       | Click upgrades to purchase, navigate buttons |

---

## 20. Special Mechanics

### Driver Buff

Placing a crew member in the locomotive's driver seat applies no damage multiplier (`DRIVER_DAMAGE_BUFF = 1.0`). The driver does not operate a weapon mount.

### Crew Roles

See Section 5 for Gunner and Brawler role details. Roles replace the old Engineer/Medic bonus system.

### Cargo Multiplier

```
multiplier = 1.0 + cargoBoxes * 0.25
```

With default 4 boxes: **2.0x gold** from all coin pickups.

### Tactical Pause (RUN_PAUSE)

Press `Space` during combat to freeze time while retaining the ability to:
- Aim weapons by moving the mouse
- Reassign crew to different mounts
- Survey the battlefield

Press `Space` again to resume.

### Weapon Acquisition Fanfare

When a new auto-weapon is acquired via level-up:
1. Game displays `"[WEAPON NAME] ACQUIRED!"` text
2. Brief freeze-frame effect (`fanfareTimer`)
3. Fanfare sound plays
4. Transitions to `PLACE_WEAPON` state for mount selection

---

## 21. Victory & Defeat

### Combat Victory

Reach `TARGET_DISTANCE = 10,000` units during a combat encounter. Distance accumulates at `TRAIN_SPEED = 167` units/sec, so a combat lasts approximately **60 seconds** minimum.

### Zone Victory

Reach the `EXIT` station on the zone map. Triggers zone-complete audio and advances to the next zone or world map.

### World Victory

Complete all 3 zones in a world. Triggers win-world audio and returns to the start screen or world select for the next world.

### Defeat

Train HP reaches 0:
- **Lost:** All `runGold` (gold earned in current encounter)
- **Kept:** Persistent gold balance, all shop upgrades
- Returns to `GAMEOVER` state, then back to `START_SCREEN`

### Progression Reset Per World

Starting a new world resets:
- Coal to 4 (max 8)
- Zone number to 1
- Train HP to max
- All in-run upgrades (auto-weapons, defenses, crew gun levels)
- Combat difficulty to base

Shop upgrades persist and are re-applied.
