# Train Defense — Unreal Engine 5.7 Porting Guide

> Complete documentation for porting the web-based Train Defense game to Unreal Engine 5.7.
> Generated 2026-04-21.

---

## How to Use This Guide

This document maps every concept from the existing web game to its Unreal Engine 5 equivalent. If you have never used UE5 before, start with Epic's official **"Your First Hour in Unreal Engine 5"** tutorial first, then come back here as your porting roadmap.

**Reading order for beginners:**
1. Read the **Glossary** below to learn the key UE5 terms
2. Read the **Game Overview** to understand what we are building
3. Read the **Prioritization Strategy** (Section 12) to understand what to build first
4. Follow the **Phased Porting Plan** (Section 13) step by step
5. Reference the other sections as needed during implementation

---

## UE5 Glossary for Beginners

These terms appear throughout this document. Refer back here when you encounter something unfamiliar.

| Term | What It Means |
|---|---|
| **Actor** | Any object placed in the game world — enemies, the train, a camera, a light. The base building block of UE5. |
| **Component** | A modular piece you attach to an Actor to give it abilities — a mesh (visual), collision (physics), audio, etc. |
| **Blueprint (BP)** | UE5's visual scripting system. You connect nodes instead of writing code. Also a type of asset file. |
| **C++** | Traditional programming. Faster than Blueprints but requires compiling. Most projects use both. |
| **UCLASS / UPROPERTY / UENUM** | C++ macros (special keywords) that register your code with the UE5 engine so it can be used in the editor and Blueprints. |
| **GameMode** | A special Actor that defines the rules of your game — win/lose conditions, what happens when a player spawns, which state the game is in. One per level. |
| **GameInstance** | An object that persists even when you switch levels/maps. Good for storing save data and gold that carries between zones. |
| **Subsystem** | A singleton service (only one exists) tied to a specific lifetime. A WorldSubsystem lives as long as the current level. |
| **Widget / UMG** | UE5's UI system (Unreal Motion Graphics). Widgets are UI elements like buttons, text labels, and health bars. |
| **Slate** | UE5's low-level UI framework underneath UMG. More performant but harder to use. You rarely need it directly. |
| **CommonUI** | A plugin that manages which UI layer receives input, preventing gameplay actions while a menu is open. |
| **DataAsset** | A simple data container you can edit in the UE5 editor without recompiling code. Great for tuning values. |
| **Enhanced Input** | UE5's input system. It separates *what the player wants to do* (Input Action) from *which button does it* (Mapping Context). |
| **Niagara** | UE5's visual effects (VFX) system for creating particles like explosions, smoke, sparks, and confetti. |
| **MetaSounds** | UE5's node-based audio system. You wire oscillators and filters together visually — similar to the Web Audio API. |
| **Sound Cue** | An older, simpler audio system. Good for basic "play this sound with random pitch variation." |
| **Socket** | A named attachment point on a 3D mesh. Like a "slot" where you can attach weapons or crew to a train car. |
| **Raycast / Line Trace** | Projecting an invisible line from a point (like the camera) to detect what it hits. Used for mouse click detection in 3D. |
| **Static Mesh** | A 3D model that does not animate (a crate, a coin, a train car). |
| **Skeletal Mesh** | A 3D model with a skeleton for animation (a walking character, a waving flag). |
| **LOD (Level of Detail)** | Simplified versions of a mesh that swap in when the object is far away, saving performance. |
| **FVector** | UE5's type for a 3D point or direction (X, Y, Z coordinates). |
| **FRotator** | UE5's type for a rotation in degrees (Pitch, Yaw, Roll). |
| **Tick** | The per-frame update function. Every Actor and Component can have one. Runs once per frame. |
| **Dynamic Material Instance** | A runtime copy of a material whose colors/properties can be changed in real-time (e.g., flashing an enemy white when hit). |
| **FBX** | A 3D model file format. UE5 imports FBX files as Static or Skeletal Meshes. |

---

## 1. Game Overview

**Genre:** Top-down isometric train defense / tower defense hybrid
**Core Fantasy:** Deliver cargo across a zombie-infested wasteland by managing crew on a moving train
**Camera:** Orthographic isometric — the camera has no perspective distortion, so objects look the same size regardless of distance. This is standard for isometric games.

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

> **Key concept for beginners:** In the web version, we wrote one big game loop that updates everything each frame. In UE5, this works differently — every object in the world is an **Actor** that updates itself via its own **Tick** function. You don't write the outer loop; the engine runs it for you. Your job is to create Actors and Components and let UE5 manage them.

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
| Max HP | 100 (upgradeable +15/level, max 175) | Store as a `UPROPERTY` variable on ATrain (makes it editable in the UE5 editor) |
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
When creating a new project in the Unreal Editor, choose the **Blank** template and select **C++** instead of Blueprint. This gives you a clean slate with full engine API access.

### Required Plugins
- **Enhanced Input** (enabled by default in 5.7) — the modern input system that separates "what the player wants to do" from "which button does it"
- **CommonUI** — helps manage which UI screen receives input, so pressing a button in a menu does not accidentally fire a weapon
- **Niagara** (enabled by default) — UE5's visual effects system for explosions, sparks, confetti, and steam

### Blueprint vs C++ Decision

| System | Approach | Reason |
|---|---|---|
| Game flow / state machine | C++ base, Blueprint transitions | Write the core logic in C++ for performance, but let designers trigger state changes visually in Blueprint |
| Enemy AI | Blueprint Behavior Tree | Behavior Trees are UE5's visual AI system — easy to design enemy behaviors without code |
| Weapon/combat logic | C++ base, Blueprint tuning | Combat runs every frame for 150+ enemies — needs C++ speed. Expose damage/range values to Blueprint for easy tweaking |
| Object pooling | C++ Subsystem | Pooling manages hundreds of actors per frame — must be as fast as possible |
| UI/HUD | Blueprint + UMG Widgets | UI layout is inherently visual — drag and drop in the UMG editor |
| Save system | C++ | Structured save data benefits from C++ type safety |
| Input | Blueprint + data assets | Enhanced Input uses editor-created assets, not code — naturally Blueprint-friendly |

### Folder Structure

**Naming prefix key:** `BP_` = Blueprint, `SM_` = Static Mesh, `WBP_` = Widget Blueprint, `NS_` = Niagara System, `IA_` = Input Action, `IMC_` = Input Mapping Context, `SC_` = Sound Cue, `MS_` = MetaSound, `DA_` = Data Asset, `GM_` = GameMode, `M_` = Material

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

**UE5 Approach:** In UE5, you define a set of named states using an **enum** (a list of labels). The `UENUM` macro tells the engine about your enum so it can be used in the visual Blueprint editor. The **GameMode** actor checks the current state each frame and decides what systems are active.

```cpp
// UENUM(BlueprintType) = make this list of states usable in Blueprints
// uint8 = store as a small number (0-255), saves memory
UENUM(BlueprintType)
enum class ETrainGameState : uint8 {
    ZoneMap,       // Selecting which station to travel to
    Setup,         // Placing crew before combat
    Running,       // Active combat
    LevelUp,       // Choosing a level-up card
    PlaceWeapon,   // Placing a new auto-weapon on a mount
    GameOver,      // Win or lose screen
    Paused,        // Pause menu
    Shop,          // Buying upgrades between zones
    Settings       // Audio and debug settings
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

**UE5 Approach:** Create a pool manager as a **WorldSubsystem** (a singleton service that lives as long as the level). In the web version, we just set `active = false` to "remove" an entity. In UE5, you must explicitly disable three things — otherwise the actor still costs performance even when invisible:

```cpp
// IPoolable = an interface (a contract) that all poolable actors must follow
// The "I" prefix is UE5's naming convention for interfaces
class IPoolable {
    virtual void OnActivated() = 0;    // Called when taken from pool
    virtual void OnDeactivated() = 0;  // Called when returned to pool
};

// When returning an actor to the pool, disable all three:
Actor->SetActorHiddenInGame(true);    // Hide the 3D model
Actor->SetActorEnableCollision(false); // Stop physics/collision checks
Actor->SetActorTickEnabled(false);     // Stop updating every frame
// When taking an actor from the pool, re-enable all three
```

> **Why all three?** In the web version, skipping an inactive entity in the game loop is free. In UE5, each of these systems runs independently — a hidden actor with collision enabled will still block bullets, and a hidden actor with tick enabled will still waste CPU.

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

**UE5 Approach:** UE5's Enhanced Input system separates "what the player wants to do" (**Input Actions** like Select, Aim, Pause) from "which button does it" (**Mapping Contexts**). You can swap Mapping Contexts based on game state — for example, switching from gameplay controls to menu-only controls when a popup appears.

**Input Actions to create:**

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

**UE5 Approach:** Create a camera Actor and set it to orthographic mode. The values below convert the web game's camera setup to UE5 units (centimeters).

```cpp
// Set camera to orthographic (no perspective distortion)
CameraComponent->ProjectionMode = ECameraProjectionMode::Orthographic;
// OrthoWidth controls how much of the world is visible (like "zoom level")
CameraComponent->OrthoWidth = 30000.f;  // 300 web units × 100 = 30,000 cm
// FVector = a 3D point (X, Y, Z). Position the camera above and to the side.
CameraComponent->SetWorldLocation(FVector(-18000, -18000, 22000));
// FRotator = rotation in degrees (Pitch, Yaw, Roll). Approximate isometric angle.
CameraComponent->SetWorldRotation(FRotator(-35, 45, 0));
```

**Screen Shake:** Use `UCameraShakeBase` (create a Blueprint subclass) with 0.2s duration, triggered on train damage. A **Spring Arm** component can also add subtle camera sway.

### 6.5 Combat / Projectiles

**Source:** `combat.js` — `fireProjectile()`, collision in `updateCombat()`

**UE5 Approach:**
- `AProjectile` Actor with **UProjectileMovementComponent** — a built-in component that handles velocity, gravity, and bouncing for projectiles (no need to write movement code!)
- **USphereComponent** — a sphere-shaped invisible collision volume attached to the projectile
- **OnComponentBeginOverlap** — an event that fires automatically when the sphere touches an enemy's collision → apply damage, return projectile to pool

**Lead Targeting** (predicting where the enemy will be when the bullet arrives):
```cpp
// Calculate how long the bullet will take to reach the enemy's current position
float TimeToHit = FVector::Dist(MountLoc, EnemyLoc) / ProjectileSpeed;
// Predict where the enemy will be by then (current position + velocity × time)
FVector PredictedLoc = EnemyLoc + EnemyVelocity * TimeToHit;
// Calculate the direction to aim (normalized = length of 1, just direction)
FVector AimDir = (PredictedLoc - MountLoc).GetSafeNormal();
```

### 6.6 Save System

**Source:** `localStorage` for audio, in-memory `save` object for progression

**UE5 Approach:** UE5 has a built-in save system. You create a class that extends **USaveGame**, list the variables you want to save using `UPROPERTY`, and call `SaveGameToSlot` / `LoadGameFromSlot`. The engine handles writing everything to a file on disk.

```cpp
// UCLASS() = register this class with the engine
// USaveGame = UE5's base class for saveable data
UCLASS()
class UTrainSaveGame : public USaveGame {
    UPROPERTY() int32 Gold;           // int32 = a whole number
    UPROPERTY() int32 Coal;
    UPROPERTY() int32 MaxCoal;
    UPROPERTY() TMap<FName, int32> UpgradeLevels;  // TMap = a dictionary/map
    UPROPERTY() float MusicVolume;    // float = a decimal number
    UPROPERTY() float SfxVolume;
};

// Save: UGameplayStatics::SaveGameToSlot(SaveObject, "Slot1", 0);
// Load: UGameplayStatics::LoadGameFromSlot("Slot1", 0);
```

Store the save object reference in your **GameInstance** — this persists across level loads, so your gold and upgrades survive when moving between zones.

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

> **Important for beginners:** UE5 uses centimeters and a different axis orientation than Three.js. Don't blindly multiply everything by 100 — you may end up with a 960-meter-wide game world! We recommend using a scale factor of **×10** (1 web pixel = 10 cm) which keeps things manageable. Whatever you choose, be **consistent everywhere**.

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

Store these in a **DataAsset** (a simple data container you can edit in the UE5 editor without recompiling code) or **DeveloperSettings** (appears in the Project Settings menu). Either way, designers can tweak values without touching C++.

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

UE5 organizes sounds into **Sound Classes**, which are like volume groups. A "Master" class contains "Music" and "SFX" sub-classes. Set the volume on a class and all sounds in that class are affected — this replaces the web game's separate `musicGain` / `sfxGainNode` setup.

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

## 12. Prioritization Strategy

### Why Order Matters

A port is not a rewrite — the game design is proven. The risk isn't "will it be fun?" but "can we make it work in UE5?" Prioritize by **technical risk** first, then **core loop**, then **meta loop**, then **polish**.

### Risk Map

| Risk | Why It's Risky | When to Prove |
|---|---|---|
| **Orthographic camera + isometric** | UE5 defaults to perspective. Ortho breaks some VFX, post-process, and culling. Prove it works before building anything on top. | Day 1 |
| **150 enemies + 300 projectiles** | Object pooling in UE5 is manual and easy to get wrong (forgetting to disable tick = wasted CPU; forgetting to disable collision = invisible blockers). Prove pool performance before building combat. | Week 1 |
| **Click-to-select crew on 3D mounts** | Mouse raycast → 3D hit → identify mount is the core interaction. If this feels bad, the game doesn't work. | Week 1 |
| **World-space health bars × 150** | Creating a separate UI widget per enemy won't scale. Need a batched drawing approach. | Week 2 |
| **Train speed + scrolling terrain** | Constant movement with parallax. If camera/terrain stutters, everything feels wrong. | Week 1 |

### Priority Tiers

```
TIER 1 — PROVE IT (kill technical risk)
  Camera rig, train movement, mouse-to-mount interaction, enemy pooling at scale

TIER 2 — CORE LOOP (one fun combat run)
  Crew assignment, manual shooting, enemy spawning, projectile collision,
  HP/damage, game over, basic HUD

TIER 3 — DEPTH (full combat variety)
  Auto-weapons (turret, steam, laser), defenses, level-up cards,
  bandit system, coins/magnets, damage numbers

TIER 4 — META LOOP (progression across runs)
  Zone map, station graph, coal resource, shop upgrades,
  save/load, world completion, difficulty scaling

TIER 5 — POLISH (match original feel)
  All audio, VFX (confetti, fireworks, muzzle flash), screen shake,
  damage flash, crew names/HUD, settings menu, keyboard nav
```

### The "Playable at Every Tier" Rule

Each tier should produce something you can play-test:
- **After Tier 1:** Train moves, you can click mounts, enemies appear and die → "Is the camera right? Does clicking feel good?"
- **After Tier 2:** Full combat run with crew → "Is it fun? Does the core loop hold up in 3D?"
- **After Tier 3:** Weapons, bandits, coins → "Does the complexity work? Is balance close?"
- **After Tier 4:** Full meta loop → "Can someone play 30 minutes and feel progression?"
- **After Tier 5:** Ship-ready → "Does it feel as good as the web version?"

### What NOT to Build Early

| Trap | Why to Avoid |
|---|---|
| Final 3D art/models | Use placeholders until gameplay is locked. Art changes are expensive. |
| MetaSounds synthesis | Import the MP3s first. Recreate synth sounds only in polish phase. |
| Full UI/UMG polish | Gray boxes with text are fine for Tiers 1-3. Pretty UI is Tier 5. |
| Zone map procedural gen | Hardcode 3 test zones. Procedural gen is Tier 4. |
| Save system | Keep state in GameInstance (memory only). Disk save is Tier 4. |
| Settings menu | Hardcode volumes. Settings is Tier 5. |

### Critical Path (shortest path to "is this port viable?")

```
Day 1-2:  Project setup → ortho camera → train actor moving along track
Day 3-4:  Enemy pool (50 first, scale to 150) → spawn from edges → move toward train
Day 5-6:  Mouse raycast → mount selection → projectile firing → enemy collision
Day 7:    DECISION POINT — Does it feel right? Is performance OK?
          If yes → proceed to Tier 2
          If no → identify what's wrong before investing more
```

This 1-week spike answers the three biggest unknowns:
1. Does orthographic isometric look right in UE5?
2. Can we pool 150+ actors without performance issues?
3. Does click-to-aim on 3D mounts feel responsive?

If any answer is "no", you know exactly what to fix before building more.

---

## 13. Phased Porting Plan

### Phase 1: Skeleton — Prove the Camera + Movement (Tier 1)
**Goal:** Train moves through scene, camera follows, basic input works
**Exit criteria:** You can watch the train scroll past at correct speed with ortho camera

- [ ] C++ project setup, folder structure
- [ ] Orthographic camera rig matching isometric angle
- [ ] ATrain actor with 4 car meshes (placeholders OK)
- [ ] Train constant-speed movement along track
- [ ] Enhanced Input: mouse click + keyboard basics
- [ ] Basic UMG HUD (HP text, distance text)

### Phase 2: Pooling + Enemies — Prove Performance (Tier 1)
**Goal:** 150 enemies spawn, move, and despawn without frame drops
**Exit criteria:** Stable 60fps with 100+ enemies on screen
**Why now:** If pooling doesn't work at scale, everything built on top is wasted

- [ ] `UActorPoolSubsystem` (C++) with Acquire/Release pattern
- [ ] AEnemy actor implementing IPoolable (activate/deactivate)
- [ ] Enemy spawn logic (wave-based from edges, move toward train)
- [ ] Stress test: spawn 150 enemies, verify no tick leaks or collision ghosts
- [ ] AProjectile with `UProjectileMovementComponent` + same pool subsystem
- [ ] Projectile pool: 300 actors, verify clean return cycle

### Phase 3: Click-to-Mount + Basic Combat — Prove Interaction (Tier 1→2)
**Goal:** Player can click a mount, fire at enemies, enemies die
**Exit criteria:** Click mount → projectile fires → hits enemy → enemy flashes and dies → feels responsive
**Why now:** This is THE core interaction. If mouse→3D mount feels laggy or imprecise, the game fails.

- [ ] WeaponMount component on train car actors
- [ ] Mouse raycast (cast an invisible line from camera through mouse cursor into 3D world) → identify clicked mount
- [ ] Basic crew weapon firing (auto-target closest enemy in range)
- [ ] Collision detection (projectile overlap → enemy)
- [ ] Damage system (HP reduction, white flash 0.1s, death)
- [ ] Damage numbers (floating text, size/color scale with damage)
- [ ] Basic HUD: HP bar, distance counter, kill counter

**⚡ DECISION POINT after Phase 3:** Play-test for 5 minutes. Does it feel right?
- Camera angle correct? → If not, adjust before Phase 4
- Clicking mounts intuitive? → If not, try larger hit areas or visual highlights
- Performance with 100 enemies + 50 projectiles? → If not, profile and fix pooling

### Phase 4: Crew Assignment — Complete Core Loop (Tier 2)
**Goal:** Full combat run from setup to game over with crew management
**Exit criteria:** Play a complete run: place crew → fight → take damage → win or die

- [ ] ACrewMember actors (3, with crew colors)
- [ ] Crew panel UI (simple UMG list)
- [ ] Left-click to select crew, right-click mount to assign
- [ ] Animated crew walk between cars (door waypoints, 120px/sec, 0.35s pause)
- [ ] Driver seat + 1.5× damage buff
- [ ] Selected crew aims at mouse (manual targeting within cone)
- [ ] Unselected crew auto-target closest enemy
- [ ] Game state machine: SETUP → RUNNING → GAMEOVER
- [ ] Win condition (distance reached) and lose condition (HP ≤ 0)
- [ ] Basic game over screen with restart

### Phase 5: Auto-Weapons + Defenses — Combat Depth (Tier 3)
**Goal:** All weapon types and defensive options work
**Exit criteria:** Player can equip turret + steam blast, activate shield, and feel the variety
**Why now:** This is what makes combat interesting beyond "click and shoot"

- [ ] Turret auto-weapon (auto-target, burst fire, pooled projectiles)
- [ ] Steam Blast aura (radius damage tick via overlap sphere, Niagara ring visual)
- [ ] Laser/Ricochet bolts (bounce logic: enemy→enemy, screen edge bounce)
- [ ] Shield defense (-2 dmg/level, min 1 damage)
- [ ] Regen defense (+3 HP/sec/level)
- [ ] Repair (instant +30 HP)
- [ ] Weapon HUD: 3 rows (Crew with names, Weapons, Defense)
- [ ] Max constraints: 2 auto-weapons, 2 defense slots

### Phase 6: Level-Up + XP — In-Run Progression (Tier 3)
**Goal:** Players grow stronger during a combat run
**Exit criteria:** Kill enemies → gain XP → pick a card → see the upgrade take effect

- [ ] XP tracking (12 per kill, threshold = level × 80)
- [ ] Level-up card generation (3 random from weighted pool)
- [ ] Card selection UI (UMG modal with hover highlight)
- [ ] Pool constraints: max 2 weapons, max 2 defense, per-crew gun cap at 5
- [ ] Apply upgrades immediately on selection
- [ ] Place weapon flow (highlight empty mounts, click to place)
- [ ] Powerup sound + confetti VFX on selection

### Phase 7: Economy — Coins, Gold, Bandits (Tier 3)
**Goal:** Gold economy and bandit threat complete
**Exit criteria:** Coins spawn, magnets collect all, bandits steal gold, crew fights them off
**Why grouped:** Coins and bandits both affect gold — test the economy as one system

- [ ] Coin spawning (every 3s, 8% magnet chance) + pooling
- [ ] Magnet: projectile hit → all coins fly to HUD
- [ ] Flying coins animation (accelerate toward HUD target)
- [ ] Gold counter with cargo multiplier
- [ ] ABandit with 5-state machine (RUNNING→JUMPING→ON_TRAIN→FIGHTING→DEAD)
- [ ] Bandit gold stealing (5g/sec on unmanned mount)
- [ ] Bandit weapon disabling (auto-weapon mount = weapon off)
- [ ] Crew fight interaction (0.5s, crew always wins)
- [ ] Steal sound loop (start when any stealing, stop when none)
- [ ] Visual: red glow + big X on disabled mounts, orange "IDLE" on guarding crew

### Phase 8: Zone Map + World Progression — Meta Loop (Tier 4)
**Goal:** Multiple combat runs connected by a zone map with strategic choices
**Exit criteria:** Navigate 3 zones, choose routes, spend coal, complete a world
**Why now:** The meta loop is what gives the game longevity. Without it, combat runs are isolated.

- [ ] UZoneData data asset (station graph, types, connections)
- [ ] Zone generation (2-3 routes, short/long, cross-connections)
- [ ] Zone map UI (UMG: station nodes, connection lines, coal cost)
- [ ] Station types: START, COMBAT (→ setup), EMPTY (rest), EXIT (→ zone complete)
- [ ] Coal resource (4 start, 1/hop, +2/win, buyable)
- [ ] Zone complete screen ("DELIVERED!" + gold summary)
- [ ] World complete screen (fireworks, confetti, bonus gold)
- [ ] Difficulty scaling: zone number × 0.2, distance-based within run
- [ ] 4 game over variants: combat win, zone complete, world complete, death

### Phase 9: Shop + Save — Persistence (Tier 4)
**Goal:** Players invest gold in permanent upgrades that carry across worlds
**Exit criteria:** Buy an upgrade → start new run → upgrade is active → save persists across sessions

- [ ] Shop UI (7 upgrade rows + coal purchase)
- [ ] Cost formula: baseCost × (currentLevel + 1)
- [ ] All 7 upgrades: damage, shield, coolOff, maxHp, baseArea, greed, crewSlots
- [ ] Crew slot unlocking (300g per slot, max 2 additional)
- [ ] USaveGame with all persistent data (gold, coal, upgrades, audio prefs)
- [ ] Save on shop exit / world complete
- [ ] Load on game start
- [ ] Settings screen (music/SFX volume sliders)

### Phase 10: Polish — Ship Quality (Tier 5)
**Goal:** Matches original game feel and adds UE5-quality enhancements
**Exit criteria:** Someone who played the web version says "this feels the same but better"

- [ ] Final 3D models imported (train, enemies, weapons, crew, bandits)
- [ ] Materials: damage flash (dynamic material instance = a runtime copy of a material whose color can change, e.g., flash white on hit), enemy tier colors
- [ ] All MP3 audio imported as USoundWave assets
- [ ] MetaSounds for synth SFX (shoot, hit, kill, train damage, powerup)
- [ ] Niagara VFX: muzzle flash, steam aura, confetti, fireworks, coin sparkle
- [ ] Screen shake on train damage (UMatineeCameraShake, 0.2s)
- [ ] Damage flash overlay (white flash on train hit)
- [ ] Game over screens (4 variants with correct buttons/flow)
- [ ] Pause menu with resume/restart/quit
- [ ] Keyboard navigation for all menus
- [ ] Balance pass: verify all tuning values match Section 9 constants
- [ ] Performance pass: profile with max enemies/projectiles, optimize hot paths
- [ ] Final audio mix: balance all volumes against each other

### Estimated Timeline (solo developer)

| Phase | Tier | Duration | Cumulative | Playable? |
|---|---|---|---|---|
| 1: Camera + Train | 1 | 2-3 days | 3 days | Train moves ✓ |
| 2: Pooling + Enemies | 1 | 3-4 days | 1 week | Enemies swarm ✓ |
| 3: Click + Combat | 1→2 | 4-5 days | 2 weeks | **Core combat works** ✓ |
| 4: Crew System | 2 | 5-6 days | 3 weeks | Full crew management ✓ |
| 5: Auto-Weapons | 3 | 4-5 days | 4 weeks | Weapon variety ✓ |
| 6: Level-Up | 3 | 3-4 days | 4.5 weeks | In-run progression ✓ |
| 7: Economy + Bandits | 3 | 5-6 days | 5.5 weeks | Full combat depth ✓ |
| 8: Zone Map | 4 | 5-6 days | 7 weeks | **Full game loop** ✓ |
| 9: Shop + Save | 4 | 3-4 days | 8 weeks | Persistence ✓ |
| 10: Polish | 5 | 2-3 weeks | 11 weeks | **Ship quality** ✓ |

**Key milestone: Week 2 (Phase 3 complete)** — This is where you know if the port is viable. If the core combat feels good in UE5, the rest is execution. If it doesn't, you've only invested 2 weeks.

---

## 14. Common Pitfalls

### Architecture
- **Don't replicate the central game loop.** In UE5, each Actor updates itself via Tick. If you try to write one big `updateAll()` function, you will fight the engine instead of working with it.
- **Don't use strings for state/type checks.** Convert string comparisons to `UENUM` types immediately. Strings are slow to compare and easy to misspell.
- **Don't call `Destroy()` on pooled actors.** Always return them to the pool. If you destroy a pooled actor, the pool loses track of it and eventually runs out of pre-allocated actors.

### Coordinates
- **Y-up → Z-up.** Every hardcoded position needs conversion.
- **Meters → Centimeters.** Multiply all distances by 100 (or choose a consistent scale).
- **Radians → Degrees.** All angle constants need conversion.
- **Right-handed → Left-handed.** Some rotation math may need a sign flip when converting.

### Performance
- **Disable tick on inactive pooled actors.** In JS, skipping an entity in a loop is free. In UE5, every ticking actor has CPU overhead even if it does nothing.
- **Use Timers for cooldowns** (UE5's built-in timer system), not manual per-frame countdown checks. Timers are more efficient and cleaner.
- **Use overlap events for range detection.** UE5's physics system can automatically notify you when actors enter a radius — much cheaper than checking distances every frame.
- **Batch UI updates.** Don't update all HUD text every frame — only update when values actually change (use a "dirty" flag pattern).

### UI
- **Don't create a widget per enemy health bar.** For 150 enemies, creating 150 separate UI widgets will tank performance. Instead, draw all health bars in a single custom widget or use world-space rendering.
- **Use CommonUI input routing** to prevent gameplay input during menus. Without it, clicking a "Buy" button in the shop might also fire a weapon behind the menu.

### Assets
- **Check FBX scale on import.** Three.js models are in meters, UE5 uses centimeters. You may need to scale models up on import.
- **Check pivot points.** The pivot is the point around which a model rotates and positions. Three.js meshes center at geometry center; UE5 expects the pivot at the actor's "feet." If your train car rotates weirdly, the pivot is probably wrong.

---

## 15. Acceptance Criteria

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
