# Train Defense — Unreal Engine 5.7 Porting Guide

> Complete documentation for porting the web-based Train Defense game to Unreal Engine 5.7.
> Generated 2026-04-21.

---

## Table of Contents

1. [Game Overview](#1-game-overview)
2. [Architecture Translation Map](#2-architecture-translation-map)
3. [Core Game Mechanics](#3-core-game-mechanics)
4. [Systems Dependency Graph](#4-systems-dependency-graph)
5. [UE5 Project Setup](#5-ue5-project-setup)
6. [System-by-System Porting Guide](#6-system-by-system-porting-guide)
7. [Asset Pipeline](#7-asset-pipeline)
8. [Coordinate System & Scale](#8-coordinate-system--scale)
9. [All Tuning Constants](#9-all-tuning-constants)
10. [UI Screens & Flow](#10-ui-screens--flow)
11. [Audio Implementation](#11-audio-implementation)
12. [Phased Porting Plan](#12-phased-porting-plan)
13. [Common Pitfalls](#13-common-pitfalls)
14. [Acceptance Criteria](#14-acceptance-criteria)

---

## 1. Game Overview

**Genre:** Top-down isometric train defense / tower defense hybrid
**Core Fantasy:** Deliver cargo across a zombie-infested wasteland by managing crew on a moving train
**Camera:** Orthographic isometric (position: -180, 220, 180; frustum: 300 units)

**Core Loop:**
```
Zone Map → Setup Crew → Combat Run (with level-ups) → Game Over → Shop → Next Zone
```

**Meta Loop:**
```
World (3 zones) → Persistent upgrades (gold) → Next World (harder)
```

**Players manage:**
- 3 crew members (Orb, Davie, Punk) on 8 weapon mounts + 1 driver seat
- Manual aiming + auto-weapons
- Coal resource for zone travel
- Gold for permanent upgrades
- Level-up cards during combat

---

## 2. Architecture Translation Map

### Core Patterns

| Web (JS/Three.js) | UE5 Equivalent | Notes |
|---|---|---|
| `requestAnimationFrame` game loop | `AActor::Tick(float DeltaTime)` | Engine manages the loop; actors tick themselves |
| ES module classes | C++ UCLASS / Blueprint | C++ for core systems, BP for tuning/iteration |
| State machine (string enum) | `UENUM` + GameMode states | 9 states: ZONE_MAP, SETUP, RUNNING, LEVELUP, PLACE_WEAPON, GAMEOVER, PAUSED, SHOP, SETTINGS |
| Object pooling (active flag arrays) | `UWorldSubsystem`-based pool | Must disable tick, collision, visibility on return |
| `canvas.addEventListener('click')` | Enhanced Input System | Input Actions + Mapping Contexts, swappable per state |
| Canvas 2D overlay | UMG Widgets | `UUserWidget` for HUD, `UWidgetComponent` for world-space bars |
| Three.js `OrthographicCamera` | `UCameraComponent` with `Orthographic` mode | Set `OrthoWidth` ≈ frustumSize |
| Web Audio API oscillators | MetaSounds | Node-based DSP graphs, nearly identical mental model |
| MP3 via `AudioBufferSource` | `USoundWave` + `UAudioComponent` | Import MP3/WAV as assets |
| `localStorage` | `USaveGame` + `SaveGameToSlot` | Structured UPROPERTY serialization |
| `toWorld(x, y)` coord mapping | Engine camera projection | Replace custom projection with `UGameplayStatics::ProjectWorldToScreen` |

### Class Hierarchy Translation

| JS Class | UE5 Class | Type |
|---|---|---|
| Game loop (main.js) | `ATrainGameMode` | GameMode |
| Save state | `UTrainSaveGame : USaveGame` | SaveGame |
| Persistent state | `UTrainGameInstance : UGameInstance` | GameInstance |
| `Train` | `ATrain : AActor` | Actor (with child car actors) |
| `TrainCar` | `ATrainCar : AActor` | Actor (attached to train) |
| `WeaponMount` | `UWeaponMountComponent` | ActorComponent |
| `CrewMember` | `ACrewMember : AActor` | Actor (attached to mount socket) |
| `Enemy` | `AEnemy : AActor` | Actor (pooled) |
| `Projectile` | `AProjectile : AActor` | Actor (pooled, use `UProjectileMovementComponent`) |
| `Bandit` | `ABandit : AActor` | Actor (pooled) |
| `Coin` | `ACoin : AActor` | Actor (pooled) |
| `Magnet` | `AMagnet : AActor` | Actor (pooled) |
| `CoinSystem` | `UCoinSubsystem : UWorldSubsystem` | Subsystem |
| `BanditSystem` | `UBanditSubsystem : UWorldSubsystem` | Subsystem |
| `Renderer3D` | Engine rendering + UMG | No equivalent needed |
| `Zone` | `UZoneData : UDataAsset` | Data-only |

---

## 3. Core Game Mechanics

### 3.1 Train System

**Structure:** 4 cars in sequence (rear weapon → cargo → front weapon → locomotive)

| Property | Value | UE5 Implementation |
|---|---|---|
| Car dimensions | 32×14px, 6px gap | Scale to UE5 units (×100 → 3200×1400cm) or redesign to fit art |
| Max HP | 100 (upgradeable +15/level, max 175) | `UPROPERTY` on ATrain, replicated if multiplayer |
| Speed | 167 px/sec (constant) | `FVector` velocity on train actor |
| Distance to win | 10,000px | Track length or timer-based |
| Cargo boxes | 4 start, multiplier: 1 + boxes × 0.25 | `UPROPERTY`, affects gold calculation |

**Damage Formula:**
```
actual_damage = max(1, enemy_contact_damage - totalShieldReduction)
totalShieldReduction = armorReduction + passives.shield × 2
```

**Regeneration:** `+3 HP/sec per regen level` (from defense slot)

### 3.2 Crew System

**3 Crew Members:**

| ID | Name | Color | Starting |
|---|---|---|---|
| 0 | Orb | #e74c3c (red) | Yes |
| 1 | Davie | #3498db (blue) | Unlockable (300g) |
| 2 | Punk | #2ecc71 (green) | Unlockable (300g) |

**Personal Weapon (Manual Gun) per crew — 5 levels:**

| Level | Damage | Fire Rate | Range |
|---|---|---|---|
| 1 | 12 | 5.0/sec | 220px |
| 2 | 16 | 5.8/sec | 235px |
| 3 | 20 | 6.6/sec | 250px |
| 4 | 24 | 7.4/sec | 265px |
| 5 | 28 | 8.2/sec | 280px |

**Crew States:**
- Idle (unassigned, in panel)
- Assigned (at mount, firing or guarding)
- Moving (animated walk through car doors, 120px/sec, 0.35s door pause)

**Driver Buff:** Crew in locomotive driver seat → all weapons deal 1.5× damage

**Reassign Cooldown:** 1 second between moves

### 3.3 Weapon Mounts

**8 mounts total** (4 per weapon car, positioned at corners)

**Mount States:**
- Empty (dashed border indicator)
- Manned (crew firing manual gun)
- Auto-weapon (turret/steam/laser)
- Bandit-occupied (disabled)

**Targeting (Crew):**
- Selected crew: aims at mouse position
- Unselected crew: auto-targets closest enemy in cone
- Cone: 45° half-angle from aim direction
- Lead calculation: predicts enemy position based on projectile travel time

**Targeting (Auto Turret):** Nearest enemy in range, burst fire with slight spread (±0.08 rad)

### 3.4 Auto-Weapons (max 2 equipped)

**Turret:**

| Level | Shots/Burst | Damage | Interval | Range |
|---|---|---|---|---|
| 1 | 1 | 10 | 1.2s | 250px |
| 2 | 2 | 12 | 1.1s | 270px |
| 3 | 3 | 14 | 1.0s | 290px |
| 4 | 4 | 16 | 0.9s | 310px |
| 5 | 5 | 18 | 0.8s | 330px |

**Steam Blast (Aura):**

| Level | Radius | Damage | Tick Rate |
|---|---|---|---|
| 1 | 80px | 4 | 0.50s |
| 2 | 105px | 7 | 0.45s |
| 3 | 130px | 10 | 0.40s |
| 4 | 155px | 13 | 0.35s |
| 5 | 180px | 16 | 0.30s |

**Laser (Ricochet):**

| Level | Bounces | Damage | Interval | Speed |
|---|---|---|---|---|
| 1 | 2 | 8 | 2.5s | 300px/s |
| 2 | 3 | 11 | 2.2s | 325px/s |
| 3 | 4 | 14 | 1.9s | 350px/s |
| 4 | 5 | 17 | 1.6s | 375px/s |
| 5 | 6 | 20 | 1.3s | 400px/s |

### 3.5 Defense Slots (max 2)

| Type | Icon | Per Level | Max Level |
|---|---|---|---|
| Shield | 🛡️ | -2 damage taken | 5 |
| Regen | 💚 | +3 HP/sec | 5 |
| Repair | 🔧 | Instant +30 HP | N/A (one-time use) |

### 3.6 Enemies

**Base Stats:**
- HP: 20, Speed: 50px/s, Radius: 6px, Contact Damage: 6

**Tiers:**

| Tier | HP Mult | Radius Mult | Visual |
|---|---|---|---|
| 0 (Green) | 1× | 1.5× | 🧟 Zombie |
| 1 (Brown) | 4× | 5× | 🧟 Zombie |
| 2 (Dark) | 6× | 5× | 🧟 Zombie |

**Kind:** 60% zombie, 40% bug (🦟) — cosmetic only

**Difficulty Scaling:**
```
distanceDiff = 1 + (trainDistance / 10000) × 2
stationDiff = 1 + (zoneNumber - 1) × 0.2
combatDifficulty = distanceDiff + (stationDiff - 1)
enemyHP = baseHP × (1 + difficulty × 0.15) × tierMult
enemySpeed = baseSpeed × (1 + difficulty × 0.1)
spawnInterval = max(0.25, 1.5 / stationDiff - difficulty × 0.2)
```

**Behavior:** Move toward random train car target (70% cargo, 15% rear, 15% front). Deal contact damage, then deactivate.

### 3.7 Bandits

| Property | Value |
|---|---|
| Speed | 110px/s (±10%) |
| Spawn interval | max(4, 15 - difficulty × 1.5) seconds |
| Steal rate | 5 gold/sec |
| Fight duration | 0.5s (crew always wins) |
| Jump duration | 0.4s |
| Max active | 10 |

**State Machine:** RUNNING → JUMPING → ON_TRAIN → FIGHTING → DEAD

**Behavior:**
- Spawn from right, run to random unmanned mount
- On mount without auto-weapon: steal gold
- On mount with auto-weapon: weapon disabled
- Crew placed on mount → fight → bandit dies

### 3.8 Coins & Economy

**Coin Spawning:**
- Every 3s (±30% random)
- 8% chance → magnet instead of coin
- Max 30 coins, 30 flying coins, 3 magnets

**Magnet:** Any projectile hit → collect ALL coins on screen (fly to HUD)

**Gold Sources:**

| Source | Amount |
|---|---|
| Coin pickup | 10g × (1 + greed% bonus) |
| Station completion | 25g per visited station |
| World completion | 200g + runGold × 0.5 |
| Combat win | runGold × cargoMultiplier |

### 3.9 Level-Up System

**Trigger:** XP ≥ level × 80 (12 XP per kill)

**3 random cards from pool:**
- Per-crew gun upgrade (if gunLevel < 5)
- New auto-weapon (if not owned and slots available)
- Upgrade existing auto-weapon (if level < 5)
- Shield defense (if defense slots available)
- Regen defense (if defense slots available)
- Repair (always available, no slot cost)

**Constraints:** Max 2 auto-weapons, max 2 defense slots

### 3.10 Zone & World Progression

**Structure:** 3 zones per world, 2-3 routes per zone

**Station Types:** START, COMBAT (⚔), EMPTY (—), EXIT (★)

**Coal:** 4 starting, 1 per hop, +2 per combat win, buyable (30g → 2 coal)

**Route Generation:**
- Short route: 2 stations (fast, less XP)
- Long route: 4-5 stations (more XP/gold, costs coal)
- Cross-connections at similar X positions (35% chance)

---

## 4. Systems Dependency Graph

```
Build order: bottom → top

                        ┌──────────┐
                        │ Zone Map │
                        └────┬─────┘
                   ┌─────────┴─────────┐
                   │                   │
             ┌─────▼─────┐      ┌─────▼─────┐
             │   Shop    │      │  Combat   │
             │(persistent│      │   Run     │
             │ upgrades) │      └─────┬─────┘
             └─────┬─────┘    ┌───────┼───────┐
                   │          │       │       │
                   ▼    ┌─────▼──┐ ┌──▼───┐ ┌─▼──────┐
             ┌────────┐ │Weapons │ │Enemy │ │ Coins  │
             │  Save  │ │(manual │ │Spawn │ │ & Gold │
             │  State │ │+ auto) │ └──┬───┘ └────────┘
             └────────┘ └───┬────┘    │
                            │    ┌────▼────┐
                       ┌────▼──┐ │ Bandits │
                       │ Crew  │ └─────────┘
                       │Assign │
                       └───┬───┘
                      ┌────▼────┐
                      │  Train  │
                      │(cars,   │
                      │ mounts, │
                      │ HP)     │
                      └────┬────┘
                      ┌────▼────────┐
                      │ Constants / │
                      │   Tuning    │
                      └─────────────┘
```

**Implementation Order:** Constants → Train → Crew → Weapons → Enemies → Combat → Coins → Bandits → Level-Up → Zone Map → Shop → Save

---

## 5. UE5 Project Setup

### Template
**Blank C++ project** — set up own camera rig and systems.

### Required Plugins
- Enhanced Input (default in 5.7)
- CommonUI (for layered menu management)
- Niagara (default, for particles)

### Blueprint vs C++ Decision

| System | Approach | Reason |
|---|---|---|
| Game flow / state machine | C++ base, BP transitions | Performance + visual iteration |
| Enemy AI | Blueprint BT | Visual, designer-friendly |
| Weapon/combat logic | C++ base, BP tuning | Performance-critical loops |
| Object pooling | C++ subsystem | Must be fast, many actors |
| UI/HUD | BP + UMG | Inherently visual layout |
| Save system | C++ | Typed UPROPERTY serialization |
| Input | BP + data assets | Enhanced Input is data-driven |

### Folder Structure

```
Content/
  TrainDefense/
    Core/
      GameModes/          GM_Combat, GM_ZoneMap
      DataAssets/          DA_ZoneConfig, DA_EnemyTier, DA_WeaponStats
      SaveGame/            BP_TrainSaveGame
      Subsystems/          BP_ActorPoolSubsystem, BP_CoinSubsystem
    Characters/
      Train/
        Meshes/            SM_Locomotive, SM_WeaponCar, SM_CargoCar
        Materials/
        Blueprints/        BP_Train, BP_TrainCar
      Crew/
        Blueprints/        BP_CrewMember
      Enemies/
        Zombie/            BP_EnemyZombie, SM_Zombie
        Bug/               BP_EnemyBug, SM_Bug
        Bandit/            BP_Bandit, SM_Bandit
    Weapons/
      Blueprints/          BP_Projectile, BP_RicochetBolt
      Meshes/              SM_ManualGun, SM_AutoTurret, SM_SteamBlast, SM_Laser
      VFX/                 NS_MuzzleFlash, NS_SteamAura
    Collectibles/
      Blueprints/          BP_Coin, BP_Magnet
      Meshes/              SM_Coin, SM_Magnet
    Environment/
      Track/               SM_Rail, SM_Sleeper
      Props/               SM_Cactus, SM_Rock
      Materials/           M_Sand, M_Track
    UI/
      HUD/                 WBP_GameHUD, WBP_CrewPanel, WBP_WeaponHUD
      Menus/               WBP_ZoneMap, WBP_Shop, WBP_LevelUp, WBP_Pause, WBP_Settings
      Shared/              WBP_Button, WBP_Slider, WBP_SlotBox
    Audio/
      Music/               SC_BackgroundMusic
      SFX/                 SC_Shoot, SC_EnemyHit, SC_CoinPickup, SC_Steal
      MetaSounds/          MS_TrainEngine (reactive to speed)
    VFX/
      Niagara/             NS_Confetti, NS_Fireworks, NS_DamageFlash
    Input/
      Actions/             IA_Select, IA_Aim, IA_Pause, IA_SelectCrew
      MappingContexts/     IMC_Gameplay, IMC_Menu, IMC_Placement
```

---

## 6. System-by-System Porting Guide

### 6.1 Game State Machine

**Source:** `main.js` — 9 states with `switch(state)` in update/render

**UE5 Approach:** Custom `UENUM` in `ATrainGameMode`

```cpp
UENUM(BlueprintType)
enum class ETrainGameState : uint8 {
    ZoneMap,
    Setup,
    Running,
    LevelUp,
    PlaceWeapon,
    GameOver,
    Paused,
    Shop,
    Settings
};
```

**State → UE5 Mapping:**

| State | UE5 Behavior |
|---|---|
| ZONE_MAP | Show WBP_ZoneMap widget, disable gameplay input |
| SETUP | Show train + crew panel, IMC_Placement input |
| RUNNING | Full gameplay tick, IMC_Gameplay input |
| LEVELUP | Pause world, show WBP_LevelUp modal, IMC_Menu |
| PLACE_WEAPON | Pause world, highlight mounts, IMC_Placement |
| GAMEOVER | Show WBP_GameOver, IMC_Menu |
| PAUSED | `UGameplayStatics::SetGamePaused(true)`, show WBP_Pause |
| SHOP | Show WBP_Shop, IMC_Menu |
| SETTINGS | Show WBP_Settings, IMC_Menu |

### 6.2 Object Pooling

**Source:** Pre-allocated arrays with `active` flag (enemies: 150, projectiles: 300, coins: 30, bandits: 10)

**UE5 Approach:** `UActorPoolSubsystem : UWorldSubsystem`

```cpp
// Pool interface
class IPoolable {
    virtual void OnActivated() = 0;
    virtual void OnDeactivated() = 0;
};

// On deactivate:
Actor->SetActorHiddenInGame(true);
Actor->SetActorEnableCollision(false);
Actor->SetActorTickEnabled(false);
// On activate: reverse all three
```

**Pool Sizes:**

| Type | Count | Priority |
|---|---|---|
| Projectiles | 300 | Critical (highest frequency) |
| Enemies | 150 | Critical |
| Damage Numbers | 80 | High |
| Coins | 30 | Medium |
| Flying Coins | 30 | Medium |
| Ricochet Bolts | 10 | Low |
| Bandits | 10 | Low |
| Magnets | 3 | Low |

### 6.3 Input System

**Source:** Mouse events (click, move) + keyboard (WASD, Escape, 1-3)

**UE5 Enhanced Input Actions:**

| Action | Trigger | Gameplay Use |
|---|---|---|
| IA_Select | LMB Pressed | Select crew, click UI buttons |
| IA_PlaceCrew | RMB Pressed | Assign crew to mount |
| IA_Aim | Mouse XY | Aim selected crew's weapon |
| IA_Pause | Escape | Toggle pause |
| IA_SelectCrew1/2/3 | Keys 1/2/3 | Quick-select crew member |

**Context Switching:**
- RUNNING: IMC_Gameplay (full controls)
- SETUP/PLACE_WEAPON: IMC_Placement (click-to-place)
- LEVELUP/SHOP/SETTINGS: IMC_Menu (UI navigation only)

### 6.4 Camera System

**Source:** Three.js OrthographicCamera at (-180, 220, 180), frustum 300, looking at origin

**UE5:**
```cpp
CameraComponent->ProjectionMode = ECameraProjectionMode::Orthographic;
CameraComponent->OrthoWidth = 30000.f;  // 300 × 100 (cm conversion)
CameraComponent->SetWorldLocation(FVector(-18000, -18000, 22000));  // converted coords
CameraComponent->SetWorldRotation(FRotator(-35, 45, 0));  // approximate isometric
```

**Screen Shake:** Use `UMatineeCameraShake` or camera spring arm with additive offset (0.2s duration on train damage)

### 6.5 Combat / Projectiles

**Source:** `combat.js` — `fireProjectile()`, collision in `updateCombat()`

**UE5 Approach:**
- `AProjectile` with `UProjectileMovementComponent` (built-in!)
- `USphereComponent` for collision overlap
- On `OnComponentBeginOverlap` → apply damage, return to pool

**Lead Targeting:**
```cpp
float TimeToHit = FVector::Dist(MountLoc, EnemyLoc) / ProjectileSpeed;
FVector PredictedLoc = EnemyLoc + EnemyVelocity * TimeToHit;
FVector AimDir = (PredictedLoc - MountLoc).GetSafeNormal();
```

### 6.6 Save System

**Source:** `localStorage` for audio, in-memory `save` object for progression

**UE5:**
```cpp
UCLASS()
class UTrainSaveGame : public USaveGame {
    UPROPERTY() int32 Gold;
    UPROPERTY() int32 Coal;
    UPROPERTY() int32 MaxCoal;
    UPROPERTY() TMap<FName, int32> UpgradeLevels;
    UPROPERTY() float MusicVolume;
    UPROPERTY() float SfxVolume;
};
```

Store reference in `UTrainGameInstance` for cross-level persistence.

---

## 7. Asset Pipeline

### 3D Models

| Asset | Source | UE5 Format | Notes |
|---|---|---|---|
| Train (4 cars) | Train.fbx (existing) | Static Mesh | Re-import, check scale (×100) |
| Enemy zombie | enemy.fbx (existing) | Static Mesh | Need LOD for 150 on-screen |
| Weapons | Gun.fbx, AutoGun.fbx, Laser.fbx, Garlic.fbx | Static Mesh | Mount socket attachment |
| Rail/track | Rail.fbx (existing) | Static Mesh | Tiling/instanced |
| Bandit | New asset needed | Skeletal or Static | Current: procedural box geometry |
| Crew | New asset needed | Skeletal or Static | Current: colored spheres |
| Coins | Procedural cylinder → SM_Coin | Static Mesh | Simple gold disc |

### Audio Files (ready to import)

| File | Type | Usage |
|---|---|---|
| music.mp3 | Background loop | `UAudioComponent` on persistent actor |
| coin.mp3 | One-shot SFX | Coin pickup |
| steal.mp3 | Looping SFX | Bandit stealing (start/stop) |
| levelup.mp3 | One-shot SFX | Level-up trigger |
| zonecomplete.mp3 | One-shot SFX | Zone cleared |
| winworld.mp3 | One-shot SFX | World beaten |
| loose.mp3 | One-shot SFX | Player death |

### Synthesized Sounds → MetaSounds

| Current SFX | Synth Type | MetaSound Approach |
|---|---|---|
| Shoot | Square wave 800→200Hz, 60ms | Oscillator + pitch envelope |
| Enemy Hit | Sine 300→80Hz, 100ms | Oscillator + ADSR |
| Enemy Kill | Noise burst + square 600→100Hz | Noise generator + oscillator mix |
| Train Damage | Sine 120→30Hz + noise, 300ms | Low oscillator + noise layer |
| Powerup | Triangle 800→1200Hz, 300ms | Oscillator + pitch step |

### UI Assets

All UI is currently code-drawn (canvas 2D). For UE5:
- Create UMG widget blueprints for each screen
- Use `UProgressBar` for HP/XP/distance bars
- Use `UTextBlock` for labels and values
- Use `UImage` for icons (import emoji-style sprites)
- Use `UButton` with custom styles for interactive elements

---

## 8. Coordinate System & Scale

### Axis Conversion

```
Three.js (Y-up, right-handed)    →    UE5 (Z-up, left-handed)

UE5.X =  ThreeJS.X × 100    (forward)
UE5.Y = -ThreeJS.Z × 100    (right, negated)
UE5.Z =  ThreeJS.Y × 100    (up)
```

### Scale Reference

| Concept | Web (px) | UE5 (cm) | Conversion |
|---|---|---|---|
| Train car width | 32 | 3,200 | ×100 |
| Enemy radius | 6 | 600 | ×100 |
| Weapon range | 220 | 22,000 | ×100 |
| Canvas width | 960 | 96,000 | ×100 |
| Train speed | 167/sec | 16,700/sec | ×100 |

**Note:** These direct conversions may result in very large UE5 units. Consider a different scale factor (e.g., ×10 or ×1) based on your art style and camera setup. The important thing is **consistency** — pick one scale factor and apply it everywhere.

### Rotation

- Web: radians, standard math angles (0 = right, π/2 = up)
- UE5: `FRotator(Pitch, Yaw, Roll)` in degrees
- Conversion: `Degrees = Radians × (180 / π)`
- Yaw in UE5 = angle from forward (X-axis), clockwise when viewed from above

---

## 9. All Tuning Constants

These should be implemented as a `UDataAsset` or `UDeveloperSettings` for easy tweaking.

### Train
```
TRAIN_MAX_HP = 100          CAR_WIDTH = 32
TRAIN_SPEED = 167           CAR_HEIGHT = 14
TARGET_DISTANCE = 10000     CAR_GAP = 6
CARGO_BOXES_START = 4       CARGO_MULTIPLIER_PER_BOX = 0.25
DRIVER_DAMAGE_BUFF = 1.5
```

### Weapons
```
WEAPON_CONE_HALF_ANGLE = 45°    PROJECTILE_SPEED = 350
WEAPON_RANGE = 220              PROJECTILE_LIFETIME = 2.0
WEAPON_FIRE_RATE = 5            PROJECTILE_RADIUS = 3
WEAPON_DAMAGE = 12              MOUNT_RADIUS = 8
```

### Manual Gun (per level: base + growth × level)
```
MANUAL_LV1_DAMAGE = 12         MANUAL_DAMAGE_GROWTH = 4
MANUAL_LV1_FIRE_RATE = 5       MANUAL_FIRE_RATE_GROWTH = 0.8
MANUAL_LV1_RANGE = 220         MANUAL_RANGE_GROWTH = 15
```

### Auto-Weapons (per level: base + growth × level)
```
TURRET_LV1_SHOTS = 1           TURRET_SHOT_GROWTH = 1
TURRET_LV1_DAMAGE = 10         TURRET_DAMAGE_GROWTH = 2
TURRET_LV1_FIRE_INTERVAL = 1.2 TURRET_INTERVAL_REDUCTION = 0.1
TURRET_LV1_RANGE = 250         TURRET_RANGE_GROWTH = 20

STEAM_LV1_RADIUS = 80          STEAM_RADIUS_GROWTH = 25
STEAM_LV1_DAMAGE = 4           STEAM_DAMAGE_GROWTH = 3
STEAM_LV1_TICK_RATE = 0.5      STEAM_TICK_REDUCTION = 0.05

LASER_LV1_BOUNCES = 2          LASER_BOUNCE_GROWTH = 1
LASER_LV1_DAMAGE = 8           LASER_DAMAGE_GROWTH = 3
LASER_LV1_FIRE_INTERVAL = 2.5  LASER_INTERVAL_REDUCTION = 0.3
LASER_LV1_SPEED = 300          LASER_SPEED_GROWTH = 25
```

### Enemies
```
ENEMY_BASE_HP = 20              ENEMY_BASE_SPEED = 50
ENEMY_RADIUS = 6               ENEMY_CONTACT_DAMAGE = 6
ENEMY_SPAWN_INTERVAL_START = 1.5    ENEMY_SPAWN_INTERVAL_MIN = 0.25
ENEMY_RADIUS_MULT = [1.5, 5, 5]     ENEMY_HP_MULT = [1, 4, 6]
MAX_ENEMIES = 150
```

### Crew
```
CREW_REASSIGN_COOLDOWN = 1.0    CREW_RADIUS = 8
CREW_COLORS = [#e74c3c, #3498db, #2ecc71]
```

### Bandits
```
BANDIT_SPEED = 110              BANDIT_SPAWN_INTERVAL = 15
BANDIT_JUMP_DURATION = 0.4      BANDIT_STEAL_RATE = 5
BANDIT_FIGHT_DURATION = 0.5     MAX_BANDITS = 10
```

### Economy
```
XP_PER_KILL = 12               XP_PER_LEVEL = 80
COIN_VALUE = 10                COIN_SPAWN_INTERVAL = 3
COIN_RADIUS = 8                COIN_FLY_SPEED = 400
MAGNET_SPAWN_CHANCE = 0.08     GOLD_PER_STATION = 25
COAL_PER_WIN = 2               COAL_SHOP_COST = 30
COAL_SHOP_AMOUNT = 2
ZONES_PER_WORLD = 3            ZONE_DIFFICULTY_SCALE = 0.2
```

### Shop Upgrades (cost × (level+1))
```
damage:    40g/level, 5 max, +15% per level
shield:    35g/level, 5 max, -2 damage per level
coolOff:   45g/level, 5 max, -10% cooldown per level
maxHp:     30g/level, 5 max, +15 HP per level
baseArea:  40g/level, 5 max, +15% range per level
greed:     60g/level, 3 max, +20% gold per level
crewSlots: 300g/level, 2 max (unlocks crew member)
```

### Object Pools
```
MAX_PROJECTILES = 300           MAX_RICOCHET_BOLTS = 10
MAX_DAMAGE_NUMBERS = 80         MAX_COINS = 30
MAX_FLYING_COINS = 30           MAX_BANDITS = 10
MAX_ENEMIES = 150               MAX_MAGNETS = 3
```

---

## 10. UI Screens & Flow

### Screen Flow Diagram
```
                    ┌──────────┐
          ┌────────►│ ZONE MAP │◄───────────┐
          │         └──┬───────┘            │
          │            │ click station      │
          │         ┌──▼───┐                │
          │         │SETUP │                │
          │         └──┬───┘                │
          │            │ depart             │
          │     ┌──────▼──────┐             │
          │     │   RUNNING   │◄──┐         │
          │     └──┬──────┬───┘   │         │
          │        │      │       │         │
          │   ┌────▼──┐ ┌─▼────┐  │         │
          │   │LEVELUP│ │GAME  │  │         │
          │   └──┬────┘ │OVER  │  │         │
          │      │      └──┬───┘  │         │
          │ ┌────▼─────┐   │      │         │
          │ │PLACE_WEAP│   │      │         │
          │ └────┬─────┘   │      │         │
          │      └─────────┘──────┘         │
          │                │                │
          │           ┌────▼───┐            │
          │           │  SHOP  ├────────────┘
          │           └────────┘
          │
     ┌────┴─────┐    ┌──────────┐
     │  PAUSED  │    │ SETTINGS │
     └──────────┘    └──────────┘
     (from any)      (from any)
```

### Per-Screen Specification

**ZONE MAP:**
- Background: sandy terrain with zombie/bug emojis scattered
- Station graph: connected nodes with type icons
- HUD: coal counter, gold counter, zone/world indicator
- Subtitle: "Deliver the cargo. Survive the wasteland."
- Zombie density increases toward later stations

**SETUP:**
- Train visible with 8 mount slots + driver seat
- Crew panel at bottom with unassigned crew
- Instructions: "Left-click to select crew. Right-click a slot to place."
- Depart button (disabled until 1+ crew on weapon mount)

**RUNNING:**
- Full 3D scene with train, enemies, projectiles
- HUD overlay: HP bar, XP bar, distance bar, gold counter, level counter
- Crew/Weapon/Defense HUD (bottom-left, 3 rows)
- Bandit alert banner (red, pulsing)
- Idle crew warning (orange, near mount)

**LEVEL UP:**
- 3 cards with icon, name, description
- Hover to enlarge, click to select
- Confetti on selection

**GAME OVER (4 variants):**
- Combat win: "STATION CLEARED!" + [CONTINUE]
- Zone complete: "DELIVERED!" + cargo/gold/coal summary + [SHOP] [NEXT ZONE]
- World complete: "WORLD COMPLETE!" + fireworks + confetti + massive gold + [CONTINUE]
- Death: "TRAIN DESTROYED" + [RESTART]

**SHOP:**
- 7 upgrade rows with level pips
- Coal purchase row
- Map button + Next Zone button

---

## 11. Audio Implementation

### UE5 Audio Architecture

```
Sound Classes:
├── Master
│   ├── Music (volume: musicVolume)
│   │   └── SC_BackgroundMusic
│   └── SFX (volume: sfxVolume)
│       ├── SC_Shoot, SC_EnemyHit, SC_EnemyKill
│       ├── SC_TrainDamage, SC_Powerup
│       ├── SC_CoinPickup, SC_StealLoop
│       ├── SC_LevelUp, SC_ZoneComplete
│       ├── SC_WinWorld, SC_Defeat
│       └── MS_TrainEngine (MetaSound, reactive)
```

### Sound Triggers

| Event | Sound | Type | Volume |
|---|---|---|---|
| Crew fires | SC_Shoot | One-shot | 0.08 |
| Bullet hits enemy | SC_EnemyHit | One-shot | 0.12 |
| Enemy dies | SC_EnemyKill | One-shot | 0.10 |
| Train takes damage | SC_TrainDamage | One-shot | 0.25 |
| Coin collected | coin.mp3 | One-shot | 0.60 |
| Level-up card selected | SC_Powerup | One-shot | 0.15 |
| Bandit stealing (start) | steal.mp3 | Loop start | SFX vol |
| Bandit stealing (stop) | steal.mp3 | Loop stop | — |
| Level-up triggered | levelup.mp3 | One-shot | 0.60 |
| Zone cleared | zonecomplete.mp3 | One-shot | 0.70 |
| World beaten | winworld.mp3 | One-shot | 0.70 |
| Player dies | loose.mp3 | One-shot | 0.70 |
| Background music | music.mp3 | Loop | Music vol |

### MetaSounds Candidates

- **Train engine:** Continuous, pitch/volume reactive to train speed
- **Steam blast aura:** Continuous hiss when active, radius affects volume
- **Ambient wasteland:** Wind, distant sounds, intensity scales with difficulty

---

## 12. Phased Porting Plan

### Phase 1: Skeleton (Core rendering + movement)
**Goal:** Train moves through scene, camera follows, basic input works

- [ ] C++ project setup, folder structure
- [ ] Orthographic camera rig matching isometric angle
- [ ] ATrain actor with 4 car meshes (placeholders OK)
- [ ] Train constant-speed movement along track
- [ ] Enhanced Input: mouse click + keyboard basics
- [ ] Basic UMG HUD (HP text, distance text)

### Phase 2: Combat Core (Enemies + shooting)
**Goal:** Enemies spawn, crew shoots them, enemies die

- [ ] AEnemy actor with pooling subsystem
- [ ] Enemy spawn logic (wave-based from edges)
- [ ] AProjectile with `UProjectileMovementComponent` + pooling
- [ ] WeaponMount component on train cars
- [ ] Manual crew weapon firing (auto-target closest)
- [ ] Collision detection (projectile→enemy)
- [ ] Damage system (HP, flash, death)
- [ ] Damage numbers (floating text)

### Phase 3: Crew System
**Goal:** Player can assign crew to mounts, driver buff works

- [ ] ACrewMember actors (3, with colors)
- [ ] Crew panel UI (UMG)
- [ ] Click-to-select, click-to-assign
- [ ] Animated crew walk between cars (door waypoints)
- [ ] Driver seat + 1.5× damage buff
- [ ] Selected crew aims at mouse (manual targeting)

### Phase 4: Auto-Weapons + Defenses
**Goal:** Full weapon variety

- [ ] Turret auto-weapon (auto-target, burst fire)
- [ ] Steam Blast aura (radius damage tick)
- [ ] Laser/Ricochet bolts (bounce logic)
- [ ] Shield defense (-damage reduction)
- [ ] Regen defense (+HP/sec)
- [ ] Repair (instant heal)
- [ ] Weapon HUD (3 rows: Crew, Weapons, Defense)

### Phase 5: Level-Up + XP
**Goal:** Progression within a run

- [ ] XP tracking, level threshold
- [ ] Level-up card generation (3 random from pool)
- [ ] Card selection UI (UMG modal)
- [ ] Apply upgrades (crew gun level, new weapons, defenses)
- [ ] Place weapon flow (click mount to place)

### Phase 6: Economy + Coins
**Goal:** Gold flows correctly

- [ ] Coin spawning + pickup
- [ ] Magnet mechanic (collect all)
- [ ] Flying coins animation
- [ ] Gold counter HUD
- [ ] Cargo multiplier calculation

### Phase 7: Bandits
**Goal:** Bandits threaten the train

- [ ] ABandit actor with state machine (5 states)
- [ ] Bandit spawning from right
- [ ] Jump-onto-train animation
- [ ] Gold stealing mechanic
- [ ] Weapon disabling mechanic
- [ ] Crew fight interaction
- [ ] Steal sound loop (start/stop)

### Phase 8: Zone Map + World Progression
**Goal:** Full meta-game loop

- [ ] Zone generation (procedural station graph)
- [ ] Zone map UI (UMG)
- [ ] Station types (combat, empty, exit)
- [ ] Coal resource management
- [ ] World completion (3 zones)
- [ ] Difficulty scaling per zone

### Phase 9: Shop + Persistence
**Goal:** Progression across runs

- [ ] Shop UI (7 upgrades + coal)
- [ ] USaveGame for gold, coal, upgrade levels
- [ ] Shop cost formula (cost × (level+1))
- [ ] Crew slot unlocking
- [ ] Settings (volume sliders, persist to save)

### Phase 10: Polish
**Goal:** Matches original game feel

- [ ] All 3D models imported and positioned
- [ ] All audio (MP3 imports + MetaSounds for synth SFX)
- [ ] Niagara VFX: muzzle flash, confetti, fireworks, steam aura
- [ ] Screen shake on damage
- [ ] Damage flash overlay
- [ ] Game over screens (4 variants)
- [ ] Pause menu
- [ ] Keyboard navigation for all menus
- [ ] Balance pass (match original tuning values)

---

## 13. Common Pitfalls

### Architecture
- **Don't replicate the central game loop.** Let actors tick themselves. Use GameMode for rules only.
- **Don't use strings for state/type checks.** Port to `UENUM` immediately.
- **Don't forget `Destroy()` vs pool return.** Pooled actors must never be destroyed.

### Coordinates
- **Y-up → Z-up.** Every hardcoded position needs conversion.
- **Meters → Centimeters.** Multiply all distances by 100 (or choose a consistent scale).
- **Radians → Degrees.** All angle constants need conversion.
- **Right-handed → Left-handed.** Negate one axis in cross products and rotations.

### Performance
- **Disable tick on inactive pooled actors.** Unlike JS where skipping is free, UE5 ticking actors have overhead.
- **Use Timers for cooldowns**, not per-frame checks (`GetWorldTimerManager().SetTimer`).
- **Use overlap events**, not per-frame distance checks for range detection.
- **Batch UI updates.** Don't update all HUD text every frame — use dirty flags.

### UI
- **Don't create a widget per enemy health bar.** For 150 enemies, use batched canvas drawing or a single widget with custom paint.
- **Use CommonUI input routing** to prevent gameplay input during modal menus.

### Assets
- **Check FBX scale on import.** Three.js models will likely need ×100 scale factor.
- **Check pivot points.** Three.js meshes center at geometry center; UE5 expects pivot at actor origin.

---

## 14. Acceptance Criteria

Each ported system should be verified against the original:

| System | Test |
|---|---|
| Train movement | Reaches end at same relative time (10,000 ÷ 167 ≈ 60s) |
| Crew damage | Manual gun Lv1 deals 12 dmg, Lv5 deals 28 dmg |
| Driver buff | All weapons deal 1.5× with crew on driver seat |
| Enemy HP scaling | Zone 1 base enemy: 20 HP. Zone 3 boss: ~40+ HP |
| Turret burst | Lv3 fires 3 shots per burst |
| Steam radius | Lv1: 80px equivalent, Lv5: 180px equivalent |
| Laser bounces | Lv1: 2 bounces, Lv5: 6 bounces |
| Coin value | 10g per coin × greed multiplier |
| Bandit steal rate | 5g/sec while on unmanned mount |
| Coal consumption | 1 per hop, +2 per combat win |
| Shop costs | Damage Lv1: 40g, Lv2: 80g, Lv3: 120g |
| Level-up XP | Level 1→2: 80 XP (≈7 kills), Level 5→6: 480 XP (≈40 kills) |
| Max crew | 3 (1 base + 2 unlockable at 300g each) |
| Game over types | 4 distinct screens: combat win, zone complete, world complete, death |

---

*This document should be kept alongside the source code and updated as the port progresses. Each phase completion should be tagged in version control.*
