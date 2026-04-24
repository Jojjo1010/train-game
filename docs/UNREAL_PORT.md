# Train Defense — UE5 Blueprint Recreation Guide

> Step-by-step guide to recreating Train Defense in Unreal Engine 5.7 using Blueprints.
> Game mechanics and tuning values live in GAME_DOCS.md — this guide covers UE5 implementation only.
> Updated 2026-04-22.

---

## How to Use This Guide

- Each step is a self-contained task
- Complete them in order — each builds on the previous
- Game mechanics details are in GAME_DOCS.md — this guide covers UE5 implementation only
- Every step ends with a **Verify** checklist
- Blueprint node names are written in **bold** (e.g., **Set Projection Mode**)
- When a step says "create a variable," that means adding a variable in the Blueprint's My Blueprint panel

---

## UE5 Glossary

| Term | What It Means |
|---|---|
| **Actor** | Any object placed in the game world — enemies, the train, a camera, a light. The base building block of UE5. |
| **Component** | A modular piece you attach to an Actor to give it abilities — a mesh (visual), collision (physics), audio, etc. |
| **Blueprint (BP)** | UE5's visual scripting system. You connect nodes instead of writing code. Also a type of asset file. |
| **GameMode** | A special Actor that defines the rules of your game — win/lose conditions, what happens when a player spawns, which state the game is in. One per level. |
| **GameInstance** | An object that persists even when you switch levels/maps. Good for storing save data and gold that carries between zones. |
| **Widget / UMG** | UE5's UI system (Unreal Motion Graphics). Widgets are UI elements like buttons, text labels, and health bars. |
| **CommonUI** | A plugin that manages which UI layer receives input, preventing gameplay actions while a menu is open. |
| **DataAsset** | A simple data container you can edit in the UE5 editor without recompiling code. Great for tuning values. |
| **Enhanced Input** | UE5's input system. It separates *what the player wants to do* (Input Action) from *which button does it* (Mapping Context). |
| **Niagara** | UE5's visual effects (VFX) system for creating particles like explosions, smoke, sparks, and confetti. |
| **MetaSounds** | UE5's node-based audio system. You wire oscillators and filters together visually — similar to the Web Audio API. |
| **Sound Cue** | An older, simpler audio system. Good for basic "play this sound with random pitch variation." |
| **Socket** | A named attachment point on a 3D mesh. Like a "slot" where you can attach weapons or crew to a train car. |
| **Line Trace** | Projecting an invisible line from a point (like the camera) to detect what it hits. Used for mouse click detection in 3D. |
| **Static Mesh** | A 3D model that does not animate (a crate, a coin, a train car). |
| **FVector** | UE5's type for a 3D point or direction (X, Y, Z coordinates). |
| **FRotator** | UE5's type for a rotation in degrees (Pitch, Yaw, Roll). |
| **Tick** | The per-frame update function. Every Actor and Component can have one. Runs once per frame. |
| **Dynamic Material Instance** | A runtime copy of a material whose colors/properties can be changed in real-time (e.g., flashing an enemy white when hit). |
| **Timeline** | A Blueprint node that interpolates values over time — used for smooth animations like movement, fading, and scaling. |
| **UProjectileMovementComponent** | A built-in component that handles velocity, gravity, and bouncing for projectiles without writing movement code. |

---

## Prerequisites & Project Setup

### Template
Create a new project using the **Third Person** template (Blueprint). This gives you a working character, camera, and Enhanced Input setup to cannibalize.

### Required Plugins
Enable these in Edit > Plugins:
- **Enhanced Input** (enabled by default in 5.7)
- **CommonUI** — manages input routing between gameplay and menus
- **Niagara** (enabled by default) — particle/VFX system

### Custom Collision Channels
Define these custom Object Channels in Project Settings > Collision (Edit > Project Settings > Engine > Collision):

| Channel | Purpose | Blocks | Overlaps |
|---|---|---|---|
| `Projectile` | Player projectiles | — | Enemy, Collectible |
| `Enemy` | Enemy actors | TrainBody | Projectile, Crew |
| `Crew` | Crew member actors | — | Enemy |
| `Collectible` | Coins and magnets | — | Projectile |
| `TrainBody` | The train's collision hull | Enemy | — |

Set each BP's collision component to the appropriate channel. This prevents projectiles from hitting the train, enemies from overlapping each other via expensive checks, and gives clean separation for line traces and overlap queries.

### Blueprint vs C++ Decision

This guide is 100% Blueprint. If you later find performance bottlenecks (especially with 150 pooled enemies), consider moving these specific systems to C++:
- Object pool manager
- Projectile collision checks
- Enemy spawning

Everything else (state machine, UI, weapons, crew, economy) works fine as Blueprints.

### Folder Structure

**Naming prefix key:** `BP_` = Blueprint, `SM_` = Static Mesh, `WBP_` = Widget Blueprint, `NS_` = Niagara System, `IA_` = Input Action, `IMC_` = Input Mapping Context, `SC_` = Sound Cue, `MS_` = MetaSound, `DA_` = Data Asset, `GM_` = GameMode, `M_` = Material

```
Content/
  TrainDefense/
    Core/
      GameModes/          GM_TrainDefense
      DataAssets/          DA_WeaponStats, DA_EnemyTiers, DA_ShopUpgrades
      SaveGame/            BP_TrainSaveGame
    Train/
      Meshes/              SM_Locomotive, SM_WeaponCar, SM_CargoCar
      Materials/
      Blueprints/          BP_Train
    Crew/
      Blueprints/          BP_CrewMember
    Enemies/
      Blueprints/          BP_Enemy, BP_Bandit
      Meshes/              SM_Zombie, SM_Bug
    Weapons/
      Blueprints/          BP_Projectile, BP_RicochetBolt
      Meshes/              SM_ManualGun, SM_AutoTurret, SM_Garlic, SM_Laser
      VFX/                 NS_MuzzleFlash, NS_GarlicAura
    Collectibles/
      Blueprints/          BP_Coin, BP_Magnet
      Meshes/              SM_Coin, SM_Magnet
    Environment/
      Track/               SM_Rail, SM_Sleeper
      Props/               SM_Cactus, SM_Rock
      Materials/           M_Sand, M_Track
    UI/
      HUD/                 WBP_GameHUD, WBP_CrewPanel
      Menus/               WBP_ZoneMap, WBP_Shop, WBP_LevelUp, WBP_Pause
      Menus/               WBP_Settings, WBP_GameOver, WBP_StartScreen
      Shared/              WBP_Button, WBP_Slider
    Audio/
      Music/               SC_BackgroundMusic
      SFX/                 SC_Shoot, SC_EnemyHit, SC_CoinPickup
      MetaSounds/          MS_TrainEngine
    VFX/
      Niagara/             NS_Confetti, NS_Fireworks, NS_DamageFlash, NS_ShockwaveEffect
    Input/
      Actions/             IA_Select, IA_Aim, IA_Pause, IA_SelectCrew, IA_CycleCrew
      MappingContexts/     IMC_Gameplay, IMC_Menu, IMC_Placement
```

---

## Step 1: Camera & Scene Setup

**Goal:** Orthographic isometric camera looking at the origin, matching the web game's view.

### What to Create
- A **CameraActor** placed in the level (or a Blueprint with a CameraComponent)

### Blueprint Instructions

1. In your level, Place Actors > Camera Actor. Name it `IsometricCamera`.
2. Select it and in the Details panel:
   - **Projection Mode:** Set to `Orthographic`
   - **Ortho Width:** `30000` (this is the frustum size — 300 web units x 100 cm)
3. Set the camera transform:
   - **Location:** X = `-18000`, Y = `-18000`, Z = `22000`
   - **Rotation:** Pitch = `-35`, Yaw = `45`, Roll = `0`
4. In your **GM_TrainDefense** GameMode Blueprint, on **Event BeginPlay**:
   - **Get Player Controller** (index 0)
   - **Set View Target with Blend** → target = reference to IsometricCamera

### Key Blueprint Nodes
- **Set Projection Mode** (on CameraComponent)
- **Set Ortho Width** (on CameraComponent)
- **Set World Location** / **Set World Rotation**
- **Set View Target with Blend** (on PlayerController)

### Web-to-UE5 Translation
The web game uses `THREE.OrthographicCamera` at position (-180, 220, 180) with frustum 300. In UE5:
- Three.js Y-up becomes UE5 Z-up: position (-180, 220, 180) becomes (-18000, -18000, 22000) in cm
- Frustum size 300 becomes OrthoWidth 30000
- The isometric look-at angle translates to roughly Pitch=-35, Yaw=45

### Screen Shake Setup
Create a **MatineeCameraShake** Blueprint (right-click Content Browser > Blueprint Class > search "Matinee Camera Shake"):
- Duration: `0.2` seconds
- Location amplitude: `(5, 5, 5)`
- Rotation amplitude: `(1, 1, 1)`
- Name it `CS_TrainDamage`

### Verify
- [ ] Camera is orthographic (no perspective distortion — parallel lines stay parallel)
- [ ] You can see the origin point in the viewport
- [ ] Objects at different distances appear the same size
- [ ] The view angle matches isometric (roughly 35 degrees down, 45 degrees rotated)

---

## Step 2: Train Actor & Movement

**Goal:** A 4-car train that moves at constant speed through the scene.

### What to Create
- **BP_Train** Actor Blueprint with 4 Static Mesh Components as children

### Blueprint Instructions

1. Create a new Actor Blueprint: `BP_Train`
2. Add a **Scene Component** as root (named `TrainRoot`)
3. Add 4 **Static Mesh Components** as children of TrainRoot:
   - `LocomotiveMesh` (front)
   - `FrontWeaponCarMesh`
   - `CargoCarMesh`
   - `RearWeaponCarMesh`
4. Position each car along the X-axis with gaps:
   - CAR_WIDTH = 32 web units = 3200 cm, CAR_GAP = 6 web units = 600 cm
   - Locomotive: X = 0
   - FrontWeaponCar: X = -3800 (3200 + 600)
   - CargoCar: X = -7600
   - RearWeaponCar: X = -11400
5. Import `Train.fbx` and assign meshes (or use placeholder cubes scaled to 3200 x 1400 x 1400)

### Variables (on BP_Train)
| Variable | Type | Default |
|---|---|---|
| `CurrentHP` | Float | 150.0 |
| `MaxHP` | Float | 150.0 |
| `TrainSpeed` | Float | 16700.0 (167 x 100 cm/s) |
| `DistanceTraveled` | Float | 0.0 |
| `TargetDistance` | Float | 1000000.0 (10000 x 100) |

### Movement (Event Tick)
1. **Event Tick** → get `Delta Seconds`
2. **Float x Float**: `TrainSpeed` x `Delta Seconds` = `FrameDistance`
3. **Add** `FrameDistance` to `DistanceTraveled`
4. **Add Actor World Offset**: X = `FrameDistance`, Y = 0, Z = 0

### HP System — Custom Events
Create these custom events on BP_Train:

**ReceiveTrainDamage(Amount: Float):**
1. Subtract `Amount` from `CurrentHP`
2. **Clamp** to min 0
3. **Branch**: if `CurrentHP` <= 0 → call `OnTrainDestroyed` event
4. **Play World Camera Shake** using `CS_TrainDamage`

> **Note:** Do not name this `TakeDamage` — UE5 has a built-in `TakeDamage` event on AActor. Shadowing it causes unpredictable behavior. Use `ReceiveTrainDamage` (or `ApplyTrainDamage`) instead.

**HealTrain(Amount: Float):**
1. Add `Amount` to `CurrentHP`
2. **Clamp** to max `MaxHP`

### Key Blueprint Nodes
- **Event Tick** + **Delta Seconds**
- **Add Actor World Offset**
- **Set Actor Location**
- **Clamp (Float)**
- **Play World Camera Shake** (for damage feedback)

### Web-to-UE5 Translation
The web game updates train position each frame in the central game loop. In UE5, the train Actor handles its own movement in its own Tick. The key difference: UE5 uses centimeters, so multiply all web pixel values by 100.

### Verify
- [ ] Train appears in the level with 4 visible car meshes
- [ ] Train moves smoothly along X-axis at constant speed
- [ ] `DistanceTraveled` increments correctly
- [ ] ReceiveTrainDamage reduces HP; HealTrain restores HP
- [ ] HP never goes below 0 or above MaxHP
- [ ] Train reaches TargetDistance in roughly 60 seconds (10000 / 167)

---

## Step 3: Game State Machine

**Goal:** A central state machine that controls which systems are active and which UI is visible.

### What to Create
- **ETrainGameState** Enum
- State logic inside **GM_TrainDefense** GameMode Blueprint

### Blueprint Instructions

1. Right-click Content Browser > Blueprints > Enumeration. Name it `ETrainGameState`.
2. Add these enumerators (in order):
   - `StartScreen`
   - `WorldSelect`
   - `WorldMap`
   - `ZoneMap`
   - `Setup`
   - `Running`
   - `RunPause`
   - `LevelUp`
   - `PlaceWeapon`
   - `GameOver`
   - `Shop`
   - `Settings`
3. Open `GM_TrainDefense`. Add variables:
   - `CurrentState` (type: ETrainGameState, default: `StartScreen`)
   - `PreviousState` (type: ETrainGameState)
   - Widget references for each screen (type: User Widget, one per screen)

### State Transition — Custom Event: ChangeState(NewState)
1. Set `PreviousState` = `CurrentState`
2. Set `CurrentState` = `NewState`
3. Call `HideAllWidgets` (custom event that sets visibility to Hidden on all widget refs)
4. **Switch on ETrainGameState** (pin = `NewState`):
   - `StartScreen` → Show WBP_StartScreen, add IMC_Menu
   - `WorldSelect` → Show WBP_WorldSelect, add IMC_Menu
   - `WorldMap` → Show WBP_WorldMap, add IMC_Menu
   - `ZoneMap` → Show WBP_ZoneMap, add IMC_Menu
   - `Setup` → Show WBP_GameHUD + crew panel, add IMC_Placement
   - `Running` → Show WBP_GameHUD, add IMC_Gameplay, unpause
   - `RunPause` → Show WBP_Pause overlay, keep WBP_GameHUD, pause world
   - `LevelUp` → Show WBP_LevelUp over WBP_GameHUD, add IMC_Menu, pause world
   - `PlaceWeapon` → Highlight empty mounts, add IMC_Placement, pause world
   - `GameOver` → Show WBP_GameOver, add IMC_Menu
   - `Shop` → Show WBP_Shop, add IMC_Menu
   - `Settings` → Show WBP_Settings, add IMC_Menu

### Pausing the World
For states that pause gameplay (LevelUp, PlaceWeapon, RunPause):
- **Set Game Paused** = `true` (stops all Tick and physics)
- When returning to Running: **Set Game Paused** = `false`

### Key Blueprint Nodes
- **Switch on Enum** (ETrainGameState)
- **Set Game Paused**
- **Create Widget** (once at BeginPlay, store references)
- **Add to Viewport** / **Remove from Parent** (or use **Set Visibility**)
- **Get Player Controller** > **Add Mapping Context** / **Remove Mapping Context**

### Web-to-UE5 Translation
The web game uses a `switch(state)` in both `update()` and `render()`. In UE5, the GameMode Blueprint handles state transitions, and each state shows/hides the appropriate UMG widgets and swaps Enhanced Input mapping contexts.

### Verify
- [ ] Enum has all 12 states
- [ ] Calling ChangeState shows the correct widget and hides others
- [ ] Running state unpauses the game; LevelUp/PlaceWeapon/RunPause pause it
- [ ] Input only works in the current context (can't fire weapons during menus)
- [ ] PreviousState tracks correctly for "back" navigation (Settings back to whatever was before)

---

## Step 4: Input System (Enhanced Input)

**Goal:** All player input routed through Enhanced Input with context switching per game state.

### What to Create
- 7 **Input Action** assets
- 3 **Input Mapping Context** assets
- Input handling in the Player Controller Blueprint

### Input Actions (right-click > Input > Input Action)

| Asset Name | Value Type | Description |
|---|---|---|
| `IA_Select` | Digital (Bool) | Left mouse button — select crew, click UI |
| `IA_Aim` | Axis2D (Vector2D) | Mouse XY position — aim weapon |
| `IA_Pause` | Digital (Bool) | Escape key — toggle pause |
| `IA_Navigate` | Axis2D (Vector2D) | Arrow keys / WASD — menu navigation |
| `IA_Confirm` | Digital (Bool) | Enter / Space — confirm selection |
| `IA_SelectCrew` | Digital (Bool) | Keys 1, 2 — quick-select crew by index |
| `IA_CycleCrew` | Digital (Bool) | Tab key — cycle to the next crew member |

### Mapping Contexts (right-click > Input > Input Mapping Context)

**IMC_Gameplay:**
| Action | Key | Trigger |
|---|---|---|
| IA_Select | Left Mouse Button | Pressed |
| IA_Aim | Mouse XY | Every frame |
| IA_Pause | Escape | Pressed |
| IA_SelectCrew (x2) | 1, 2 | Pressed |
| IA_CycleCrew | Tab | Pressed |

**IMC_Menu:**
| Action | Key | Trigger |
|---|---|---|
| IA_Navigate | WASD / Arrows | Pressed |
| IA_Confirm | Enter / Space | Pressed |
| IA_Pause | Escape | Pressed |
| IA_Select | Left Mouse Button | Pressed |

**IMC_Placement:**
| Action | Key | Trigger |
|---|---|---|
| IA_Select | Left Mouse Button | Pressed |
| IA_Aim | Mouse XY | Every frame |
| IA_Pause | Escape | Pressed |
| IA_SelectCrew (x2) | 1, 2 | Pressed |
| IA_CycleCrew | Tab | Pressed |

### Context Switching (in GM_TrainDefense ChangeState event)
Each state transition removes all contexts then adds the appropriate one:
1. **Get Player Controller** > **Get Enhanced Input Local Player Subsystem**
2. **Clear All Mappings**
3. **Add Mapping Context** with the context for the new state + priority 0

### Mouse World Position (for aiming)
In your Player Controller Blueprint:
1. **Get Hit Result Under Cursor by Channel** (Trace Channel: Visibility)
2. If hit → **Break Hit Result** → get `Location` (this is the world position the mouse points at)
3. Store as `MouseWorldPosition` (FVector variable)
4. Update every frame in Tick (only when IMC_Gameplay is active)

### Key Blueprint Nodes
- **Get Enhanced Input Local Player Subsystem**
- **Add Mapping Context** / **Remove Mapping Context** / **Clear All Mappings**
- **Enhanced Input Action** event nodes (drag IA_Select into Event Graph)
- **Get Hit Result Under Cursor by Channel**
- **Break Hit Result**
- **Convert Mouse Location to World Space**

### Web-to-UE5 Translation
The web game uses `addEventListener('click')` and `addEventListener('mousemove')` directly. In UE5, Enhanced Input decouples the physical button from the game action. The mouse-to-world conversion replaces the web game's custom `toWorld(x, y)` projection function — UE5 does the math for you via line traces.

### Verify
- [ ] In Running state: left click fires, mouse position aims, Escape pauses, 1/2 selects crew, Tab cycles crew
- [ ] In Menu state: WASD navigates, Enter confirms, mouse clicks buttons, number keys do nothing
- [ ] In Placement state: mouse position highlights mounts, click places crew/weapon
- [ ] Context switching is clean — no input leaks between states
- [ ] Mouse world position updates correctly (place a debug sphere at the hit location to visualize)

---

## Step 5: Enemy Pooling & Spawning

**Goal:** Pre-spawn 150 enemy actors, activate/deactivate them as needed, no runtime spawning or destroying.

### What to Create
- **BP_Enemy** Actor Blueprint
- **BP_EnemyPool** Actor (or a component on GameMode) to manage the pool
- Enemy spawner logic

### BP_Enemy — Components
1. **Sphere Component** (root) — collision, radius = 600 cm (6 web px x 100)
2. **Static Mesh Component** — visual (placeholder sphere mesh)
3. **Widget Component** (optional, for world-space HP bar — but see Step 10 for batched approach)

### BP_Enemy — Variables
| Variable | Type | Default |
|---|---|---|
| `IsActive` | Bool | false |
| `CurrentHP` | Float | 20.0 |
| `MaxHP` | Float | 20.0 |
| `MoveSpeed` | Float | 5000.0 (50 x 100) |
| `ContactDamage` | Float | 8.0 |
| `Tier` | Integer | 0 |
| `TargetLocation` | FVector | (0,0,0) |
| `KnockbackVelocity` | FVector | (0,0,0) |

### BP_Enemy — Custom Events

**ActivateEnemy(SpawnLoc: FVector, EnemyTier: Integer, HP: Float, Speed: Float):**
1. **Set Actor Location** to `SpawnLoc`
2. Set `Tier`, `CurrentHP`, `MaxHP`, `MoveSpeed` from parameters
3. Set `IsActive` = true
4. **Set Actor Hidden in Game** = false
5. **Set Actor Enable Collision** = true
6. **Set Actor Tick Enabled** = true
7. Set mesh scale and color based on tier:
   - Tier 0: scale 1.5, green
   - Tier 1: scale 5.0, brown
   - Tier 2: scale 5.0, dark gray

**DeactivateEnemy():**
1. Set `IsActive` = false
2. **Set Actor Hidden in Game** = true
3. **Set Actor Enable Collision** = false
4. **Set Actor Tick Enabled** = false

### BP_Enemy — Event Tick (Movement)
1. **Get Actor Location** → store as `CurrentLoc`
2. `Direction` = **Get Unit Direction Vector** from `CurrentLoc` to `TargetLocation`
3. `MoveDelta` = `Direction * MoveSpeed * DeltaSeconds`
4. Apply knockback: `MoveDelta += KnockbackVelocity * DeltaSeconds` (then decay `KnockbackVelocity`)
5. **Add Actor World Offset** by `MoveDelta`
6. If distance to target < 100 → deal `ContactDamage` to train → call `DeactivateEnemy`

> **Note:** There is no "Move Toward" node in UE5 Blueprints. Use **Get Unit Direction Vector** to compute direction, multiply by speed and delta time, then apply via **Add Actor World Offset**. Alternatively, use **VInterp To (Constant)** for constant-speed interpolation: `NewLoc = VInterpToConstant(CurrentLoc, TargetLocation, DeltaSeconds, MoveSpeed)`.

### BP_EnemyPool — Pool Manager

**Variables:**
- `EnemyPool` (Array of BP_Enemy references), size 150
- `ProjectilePool` (Array of BP_Projectile references), size 300
- `CoinPool` (Array of BP_Coin), size 30
- `BanditPool` (Array of BP_Bandit), size 10

**Event BeginPlay — Pre-spawn:**
1. **For Loop** 0 to 149:
   - **Spawn Actor from Class** (BP_Enemy) at location (0, 0, -10000) — off-screen
   - Call `DeactivateEnemy` on the spawned actor
   - **Add** to `EnemyPool` array

**AcquireEnemy() → returns BP_Enemy reference:**
1. **For Each Loop** on `EnemyPool`
2. **Branch**: if `IsActive` == false → call `ActivateEnemy` on it → **Return** the reference
3. If no inactive enemy found → return null (pool exhausted)

### Spawner Logic (on GameMode or separate BP_Spawner)
1. Use a **Set Timer by Event** with the spawn interval (starts at 1.5s, decreases with difficulty)
2. On timer fire:
   - Calculate spawn position: random point outside camera view
   - Calculate tier: weighted random (see GAME_DOCS.md for tier distribution)
   - Calculate HP and speed using difficulty formulas (see GAME_DOCS.md)
   - Call `AcquireEnemy` with calculated values
3. Difficulty scaling recalculates spawn interval each wave

### Key Blueprint Nodes
- **Spawn Actor from Class** (only at BeginPlay for pool creation)
- **Set Actor Hidden in Game** / **Set Actor Enable Collision** / **Set Actor Tick Enabled**
- **For Each Loop** (to find inactive pool members)
- **Set Timer by Event** (for spawn intervals)
- **Get Unit Direction Vector** + **Add Actor World Offset** (manual movement)
- **VInterp To Constant** (alternative constant-speed interpolation)
- **Create Dynamic Material Instance** (to change enemy color per tier)

### Web-to-UE5 Translation
The web game pre-allocates arrays with an `active` flag and skips inactive entries in the update loop. In UE5, you must explicitly disable three things on inactive actors: visibility, collision, and tick. Forgetting any one of these causes bugs — invisible enemies blocking bullets (collision), or wasted CPU (tick).

### Verify
- [ ] 150 BP_Enemy actors exist in the world after BeginPlay (check World Outliner)
- [ ] All 150 start hidden, no-collision, no-tick
- [ ] AcquireEnemy returns an enemy and it becomes visible/active
- [ ] DeactivateEnemy hides it and stops tick/collision
- [ ] Enemies move toward the train and deal contact damage
- [ ] Tier 0/1/2 enemies have correct scale and color
- [ ] Stable 60fps with 100+ active enemies (open stat fps console command)
- [ ] No "ghost" collisions from inactive enemies

---

## Step 6: Projectile System

**Goal:** Pooled projectiles that fire from weapon mounts, travel to targets, and damage enemies on overlap.

### What to Create
- **BP_Projectile** Actor Blueprint
- Pool of 300 (managed by BP_EnemyPool or its own pool manager)

### BP_Projectile — Components
1. **Sphere Component** (root) — collision radius 300 cm (3 web px x 100)
   - Collision preset: OverlapAllDynamic
   - Generate Overlap Events: true
2. **Static Mesh Component** — small sphere or bullet mesh
3. **Projectile Movement Component**
   - Initial Speed: 35000 (350 x 100)
   - Max Speed: 35000
   - Gravity Scale: 0 (we want straight-line travel)
   - Rotation Follows Velocity: true

### BP_Projectile — Variables
| Variable | Type | Default |
|---|---|---|
| `IsActive` | Bool | false |
| `Damage` | Float | 12.0 |
| `KnockbackForce` | Float | 500.0 |
| `OwnerCrewIndex` | Integer | -1 |

### Fire Function — Custom Event: FireProjectile(Origin: FVector, Direction: FVector, Dmg: Float)
1. **Set Actor Location** to `Origin`
2. Set `Damage` = `Dmg`, `IsActive` = true
3. **Set Actor Hidden in Game** = false
4. **Set Actor Enable Collision** = true
5. **Set Actor Tick Enabled** = true
6. On the Projectile Movement Component: **Set** the `Velocity` property (FVector) = `Direction * 35000`
7. **Set Timer by Function Name** → `DeactivateProjectile`, time = 2.0s (lifetime limit)

### On Component Begin Overlap (Sphere Component)
1. **Cast to BP_Enemy** (the other actor)
2. If valid and enemy `IsActive`:
   - Call enemy's `ApplyEnemyDamage` event with `Damage`
   - Apply knockback: add `KnockbackForce` in the projectile's forward direction to the enemy's `KnockbackVelocity` vector (see note below)
   - Call `DeactivateProjectile`

### DeactivateProjectile()
Same pattern as enemy: set hidden, disable collision, disable tick, set `IsActive` = false.

### Lead Targeting (for auto-aim)
When calculating where to fire, predict enemy position:
1. `Distance` = **Vector Length** of (EnemyLocation - MountLocation)
2. `TimeToHit` = `Distance / ProjectileSpeed`
3. `PredictedLoc` = EnemyLocation + (EnemyVelocity * `TimeToHit`)
4. `AimDirection` = **Normalize** (PredictedLoc - MountLocation)

### Key Blueprint Nodes
- **UProjectileMovementComponent** settings in Details panel
- **Set** `Velocity` (FVector property on ProjectileMovementComponent) — set directly, not via "Set Velocity in Local Space" which does not exist
- **On Component Begin Overlap** (event on SphereComponent)
- **Cast To** (BP_Enemy)
- **Set Timer by Function Name** (lifetime auto-deactivate)
- **Get Unit Direction Vector** / **Normalize**

> **Knockback note:** Enemies use manual movement (not physics simulation), so **Add Impulse** will not work. Instead, add a `KnockbackVelocity` FVector variable to `BP_Enemy`. On hit, set it to the projectile direction times `KnockbackForce`. In the enemy's Tick, apply `KnockbackVelocity * DeltaSeconds` via **Add Actor World Offset**, then decay: `KnockbackVelocity *= Max(0, 1 - 12 * DeltaSeconds)` (decay rate 12/sec, matching the web game's `KNOCKBACK_DECAY`).

### Web-to-UE5 Translation
The web game manually updates projectile positions each frame. UE5's **ProjectileMovementComponent** handles all of that — you just set velocity and let the component do the work. Overlap events replace the manual distance-check collision loop.

### Verify
- [ ] 300 projectiles pre-spawned and inactive
- [ ] FireProjectile makes a projectile appear at the origin and fly in the given direction
- [ ] Projectiles deactivate after 2 seconds if they hit nothing
- [ ] Overlapping an enemy deals damage and deactivates the projectile
- [ ] Enemy takes correct damage amount
- [ ] Knockback pushes enemy away from impact direction
- [ ] No projectiles "leak" (all return to pool)
- [ ] Lead targeting hits moving enemies reliably

---

## Step 7: Crew System

**Goal:** 2 crew members that can be selected, assigned to mounts, and move between car doors.

### What to Create
- **BP_CrewMember** Actor Blueprint
- Crew management logic (in GameMode or a separate BP_CrewManager)

### BP_CrewMember — Components
1. **Capsule Component** (root) — collision
2. **Static Mesh Component** — colored sphere placeholder (or character mesh)

### BP_CrewMember — Variables
| Variable | Type | Default |
|---|---|---|
| `CrewName` | String | "Rex" |
| `CrewColor` | Linear Color | Red |
| `CrewIndex` | Integer | 0 |
| `CurrentMount` | Object Ref (WeaponMount) | null |
| `IsMoving` | Bool | false |
| `WeaponLevel` | Integer | 1 |
| `IsSelected` | Bool | false |
| `ReassignCooldownRemaining` | Float | 0.0 |
| `CrewRole` | Enum (ECrewRole) | Gunner |

### Crew Data (2 instances — both available from start, no unlock cost)
| Index | Name | Color (Linear) |
|---|---|---|
| 0 | Rex | (0.91, 0.30, 0.24) Red |
| 1 | Kit | (0.20, 0.60, 0.86) Blue |

### Movement Between Mounts
Crew moves through car doors, not teleporting. Implementation:

1. Build a **waypoint array** (Array of FVector) representing door positions between cars
2. When assigned to a new mount:
   - Calculate path: current position → nearest door → through intermediate doors → destination mount
   - Store path as `MovementPath` (Array of FVector)
3. Use a **Timeline** node:
   - Play rate matches 8500 cm/s (85 web px/s)
   - Each segment: **Lerp** between current waypoint and next
   - At each door waypoint: **Delay** 0.55 seconds (door pause)
4. On arrival: set `CurrentMount`, begin firing

### Key Blueprint Nodes
- **Timeline** (for smooth interpolation between waypoints)
- **Lerp (Vector)** (interpolate position)
- **Delay** (0.55s door pause)
- **Set Actor Location** (each frame during movement)
- **Create Dynamic Material Instance** → **Set Vector Parameter** "Color" (to apply crew color)

### Web-to-UE5 Translation
The web game interpolates crew position directly in the game loop with a speed constant. In UE5, use a Timeline for the smooth movement — it automatically handles delta time and gives you a clean animation curve. The door pause uses a Delay node between path segments.

### Verify
- [ ] 2 crew members exist (Rex and Kit, both visible from the start)
- [ ] Each crew member has the correct color (Rex = red, Kit = blue)
- [ ] Selecting a crew member highlights them (glow, outline, or scale up slightly)
- [ ] Assigning to a mount starts movement through doors
- [ ] 0.55s pause at each door
- [ ] Movement speed is approximately 8500 cm/s
- [ ] Reassign cooldown prevents instant re-placement (1 second)
- [ ] Crew arrives at mount and stops moving

---

## Step 8: Weapon Mount System

**Goal:** 8 mount positions on the weapon cars where crew or auto-weapons can be placed.

### What to Create
- **WeaponMount** as a custom component or child Actor on each weapon car
- 4 mounts per weapon car, positioned at corners

### Mount Positions (relative to each weapon car)
Each weapon car has 4 corner positions:
```
Top-Left:     (-HalfWidth, +HalfHeight, 0)  → (-1600, +700, 0)
Top-Right:    (+HalfWidth, +HalfHeight, 0)  → (+1600, +700, 0)
Bottom-Left:  (-HalfWidth, -HalfHeight, 0)  → (-1600, -700, 0)
Bottom-Right: (+HalfWidth, -HalfHeight, 0)  → (+1600, -700, 0)
```

### Mount Data — Variables (per mount)
| Variable | Type | Default |
|---|---|---|
| `MountIndex` | Integer | 0-7 |
| `AimDirection` | FVector | outward from train |
| `ConeHalfAngle` | Float | 45.0 (degrees) |
| `OccupantType` | Enum (Empty/Crew/AutoWeapon/Bandit) | Empty |
| `AssignedCrew` | Object Ref | null |
| `AutoWeaponType` | Enum (None/Turret/AutoLaser/Laser) | None |
| `AutoWeaponLevel` | Integer | 0 |
| `Cooldown` | Float | 0.0 |

### Mount Interaction (click to assign crew)
1. Player selects a crew member (IA_SelectCrew or click on crew panel)
2. Player clicks a mount (IA_Select → line trace → hit mount collision)
3. If mount is Empty or has a bandit:
   - Set mount's `OccupantType` = Crew
   - Set `AssignedCrew` = selected crew
   - Tell crew to move to this mount's world position
4. If mount already has crew, swap them

### Auto-Weapon Assignment (from level-up)
1. Player picks "new turret" card → enters PlaceWeapon state
2. Empty mounts highlight with a pulsing outline
3. Player clicks a mount → set `OccupantType` = AutoWeapon, `AutoWeaponType` = Turret, `AutoWeaponLevel` = 1
4. Return to Running state

### Firing Logic (on Event Tick, per active mount)
**If occupied by Crew:**
- If this crew is selected by player → aim at `MouseWorldPosition` (from Step 4)
- If not selected → auto-target closest enemy within cone
- Fire projectile at fire rate interval (check cooldown timer)

**Cone check** (is enemy within firing arc?):
1. `DirectionToEnemy` = **Normalize**(EnemyLocation - MountLocation)
2. `DotProduct` = **Dot Product**(AimDirection, DirectionToEnemy)
3. `AngleDeg` = **Acos**(DotProduct) in degrees
4. **Branch**: AngleDeg <= ConeHalfAngle → enemy is in cone

### Key Blueprint Nodes
- **Line Trace by Channel** (from camera through mouse → detect mount click)
- **Dot Product** + **Acos** (cone angle check)
- **Get All Actors of Class** or **Sphere Overlap Actors** (find enemies in range)
- **Set Timer by Event** (fire rate cooldown)
- **Draw Debug Cone** (visualization during development — remove for ship)

### Web-to-UE5 Translation
The web game stores mounts as data objects with position offsets. In UE5, each mount is a Scene Component (or child Actor) physically attached to the weapon car. The cone check uses the same dot-product math, just with UE5's built-in vector functions.

### Verify
- [ ] 8 mounts visible on the two weapon cars (4 each)
- [ ] Clicking a mount with a selected crew assigns them there
- [ ] Empty mounts show a visual indicator (dashed border or glow)
- [ ] Occupied mounts show the crew member or weapon icon
- [ ] Bandit-occupied mounts show as disabled
- [ ] Cone angle check correctly filters targets (enemy outside cone is not shot at)
- [ ] Selected crew aims at mouse; unselected crew auto-targets
- [ ] Driver seat (locomotive) exists as a special 9th position

---

## Step 9: Auto-Weapons

**Goal:** 3 types of auto-weapons that fire independently when placed on mounts.

### What to Create
- Auto-weapon logic on weapon mounts (or as child components)
- Data-driven stats using a **DataAsset** or **DataTable**

### DA_WeaponStats (Data Asset)
Create a **Primary Data Asset** Blueprint with arrays for each weapon type's per-level stats. Or use a **DataTable** with rows:

| WeaponType | Level | Damage | FireInterval | Range | Special |
|---|---|---|---|---|---|
| Turret | 1 | 10 | 1.2 | 25000 | Shots: 1 |
| Turret | 2 | 12 | 1.1 | 27000 | Shots: 2 |
| ... | ... | ... | ... | ... | ... |

(See GAME_DOCS.md for all 15 rows of weapon stats.)

### Turret Implementation
On mount Tick (when `AutoWeaponType` == Turret):
1. Check cooldown timer. If not ready, skip.
2. **Sphere Overlap Actors** centered on mount position, radius = weapon range
3. Filter to active BP_Enemy actors
4. Pick nearest enemy
5. **For Loop** from 0 to `ShotsPerBurst - 1`:
   - Calculate aim direction toward enemy with slight spread: `BaseDirection` + **Random Unit Vector** x 0.08
   - Call pool's `AcquireProjectile` → `FireProjectile` with aim direction
   - **Delay** 0.08s between shots in burst
6. Reset cooldown timer

### Auto Laser Implementation
On mount Tick (when `AutoWeaponType` == AutoLaser):
1. Check cooldown timer. If not ready, skip.
2. **Sphere Overlap Actors** centered on mount, radius = weapon range — **no cone restriction** (full 360-degree targeting)
3. Pick nearest active `BP_Enemy`
4. Fire a single `BP_Projectile` toward the target (same pool as Turret projectiles)
5. Reset cooldown timer
6. Visual: uses the Garlic 3D model (`SM_Garlic` / `Garlic.fbx`) as the mount mesh. No separate aura ring.

### Laser / Ricochet Implementation
On mount fire timer:
1. Find nearest enemy in range
2. Spawn a **BP_RicochetBolt** (pooled, max 10):
   - Set initial target = nearest enemy
   - Set `BouncesRemaining` = level-dependent (2 at Lv1, up to 6 at Lv5)
3. BP_RicochetBolt Tick:
   - Move toward current target at bolt speed
   - On overlap with enemy:
     - Deal damage
     - Decrement `BouncesRemaining`
     - If bounces > 0: find next nearest enemy (excluding already-hit enemies) → retarget
     - If bounces == 0: deactivate bolt

### Key Blueprint Nodes
- **Sphere Overlap Actors** (for finding enemies in range)
- **Get Distance To** (for nearest-enemy selection)
- **Set Timer by Event** (fire interval / tick rate)
- **Spawn Emitter at Location** or **Activate Niagara Component** (for steam visual)
- **Random Unit Vector** (for turret spread)
- **For Loop** (burst fire)
- **Delay** (between burst shots)

### Web-to-UE5 Translation
The web game checks weapon cooldowns each frame and manually iterates enemies to find targets. In UE5, use **Set Timer by Event** for cooldowns (more efficient than checking every frame) and **Sphere Overlap Actors** for range detection (the physics engine does the distance math).

### Verify
- [ ] Turret auto-fires at nearest enemy in bursts matching its level
- [ ] Turret spread is visible but small (shots don't go wildly off-target)
- [ ] Auto Laser fires single projectiles at the nearest enemy with no cone restriction
- [ ] Auto Laser mount displays the Garlic mesh
- [ ] Laser bolt bounces between enemies the correct number of times per level
- [ ] Laser bolt does not bounce to the same enemy twice
- [ ] All weapons respect their fire intervals (not firing too fast)
- [ ] Max 2 auto-weapons can be equipped at once
- [ ] Weapon stats match GAME_DOCS.md values at every level

---

## Step 10: Combat & Hit Detection

**Goal:** Complete damage pipeline from projectile impact to visual feedback.

### Damage Application
When a projectile overlaps an enemy (from Step 6's OnComponentBeginOverlap):

1. Calculate final damage:
   ```
   FinalDamage = BaseDamage
     * DriverBuff (1.0 — currently no damage bonus from driver seat)
     * ShopDamageMultiplier (1.0 + shopDamageLevel * 0.15)
   ```
2. Apply to enemy: subtract from `CurrentHP`
3. If `CurrentHP` <= 0 → kill enemy

### Train Damage (when enemy reaches train)
1. Calculate actual damage:
   ```
   ShieldReduction = passiveShieldSlots * 2  (Shield is a run-time defense, not a shop upgrade)
   ActualDamage = Max(1, EnemyContactDamage - ShieldReduction)
   ```
2. Call `BP_Train.ReceiveTrainDamage(ActualDamage)`

### Damage Numbers — Floating Text
Create a **WBP_DamageNumber** widget:
1. Contains one **Text Block** (shows damage value)
2. Pool 80 of these (using Widget Component or spawning to viewport)

**On damage dealt:**
1. Acquire damage number from pool
2. Set text to damage value, color by context (white = normal, yellow = crit, red = train damage)
3. Scale text size: `BaseSize * (1 + Damage / 50)` — bigger hits = bigger numbers
4. Animate upward: **Timeline** over 0.8s
   - Position: float up 500 cm
   - Opacity: fade from 1.0 to 0.0
5. On Timeline finished: deactivate / return to pool

### Hitstop (2-frame pause)
On significant hits (kills, high damage):
1. **Set Global Time Dilation** to `0.01` (near-freeze)
2. **Delay** 0.033s (roughly 2 frames at 60fps)
3. **Set Global Time Dilation** back to `1.0`

### Screen Shake
On train damage or surge start:
1. **Play World Camera Shake** at the train's world location, with `CS_TrainDamage` (created in Step 1)
   - Use **Play World Camera Shake** for positional shakes (damage from a world location)
   - Use **Client Start Camera Shake** for non-positional shakes (e.g., surge rumble that affects the whole screen regardless of position)

### Enemy Hit Flash
When an enemy takes damage:
1. **Get Dynamic Material Instance** on the enemy's mesh
2. **Set Scalar Parameter** "FlashAmount" = 1.0 (white overlay)
3. **Delay** 0.1s
4. **Set Scalar Parameter** "FlashAmount" = 0.0

This requires a material with a "FlashAmount" parameter that lerps between the base color and white.

### Key Blueprint Nodes
- **Set Global Time Dilation** (hitstop)
- **Play World Camera Shake** (positional screen shake) / **Client Start Camera Shake** (non-positional)
- **Create Dynamic Material Instance** + **Set Scalar Parameter** (hit flash)
- **Timeline** (damage number float-up animation)
- **Project World to Screen** (if positioning damage numbers in screen space)

### Web-to-UE5 Translation
The web game draws damage numbers directly on the canvas each frame. In UE5, you either use world-space Widget Components (expensive at scale) or a single batched UMG widget that draws all numbers. The hitstop effect uses Time Dilation instead of the web game's frame-skip approach.

### Verify
- [ ] Enemies take correct final damage (with all multipliers applied)
- [ ] Train takes damage reduced by shield
- [ ] Minimum damage is 1 (never 0)
- [ ] Damage numbers appear at the hit location and float upward
- [ ] Bigger hits show bigger text
- [ ] Hitstop briefly pauses the game on kills
- [ ] Screen shakes when train takes damage
- [ ] Enemy flashes white for 0.1s on hit
- [ ] Kill triggers XP gain (12 XP per kill, see GAME_DOCS.md)

---

## Step 11: Bandit System

**Goal:** Bandits run toward the train, jump onto unmanned mounts, steal gold, and can be defeated by crew.

### What to Create
- **BP_Bandit** Actor Blueprint
- Pool of 10 bandits

### BP_Bandit — State Machine Enum
Create `EBanditState` enumeration:
- `Inactive`
- `Running`
- `Jumping`
- `OnTrain`
- `Fighting`
- `Dead`

### BP_Bandit — Variables
| Variable | Type | Default |
|---|---|---|
| `BanditState` | EBanditState | Inactive |
| `TargetMount` | Object Ref | null |
| `MoveSpeed` | Float | 11000 (110 x 100, +/- 10% random on activate) |
| `StealTimer` | Float | 0.0 |
| `FightTimer` | Float | 0.0 |
| `JumpProgress` | Float | 0.0 |
| `JumpStartLoc` | FVector | - |
| `JumpEndLoc` | FVector | - |

### Event Tick — Switch on EBanditState

**Running:**
1. Move toward `TargetMount` world position at `MoveSpeed * DeltaSeconds`
2. When within jump range (500 cm): transition to `Jumping`

**Jumping:**
1. Increment `JumpProgress` by `DeltaSeconds / 0.4` (0.4s jump duration)
2. Interpolate position using a parabolic curve:
   - Horizontal: **Lerp** from `JumpStartLoc` to `JumpEndLoc` by `JumpProgress`
   - Vertical: add `Sin(JumpProgress * PI) * 2000` (arc height of 2000 cm)
3. When `JumpProgress` >= 1.0: land on mount, transition to `OnTrain`
   - Set mount's `OccupantType` = Bandit
   - If mount has auto-weapon → disable it

**OnTrain:**
1. The bandit occupies the mount, disabling it. Gold stealing is **disabled** (steal rate = 0).
2. Check: has crew been assigned to this mount? If yes → transition to `Fighting`

**Fighting:**
1. Check the crew member's role:
   - **Gunner:** Accumulate `FightTimer` += `DeltaSeconds`. When `FightTimer` >= 0.5s: crew wins.
   - **Brawler:** Crew wins instantly (0s fight duration). Bandit is flung toward the nearest enemy cluster; on landing, deals AOE damage (60 damage, 160px radius). Play shockwave visual.
2. On crew win: transition to `Dead`, re-enable mount.

**Dead:**
1. Fling bandit off train: use a **Timeline** to animate the bandit position along an upward + outward arc (enemies and bandits use manual movement, not physics, so **Add Impulse** will not work)
2. After 1s flight: deactivate bandit (same hide/disable pattern)

### Spawner Logic
On the GameMode, a timer spawns bandits:
- Interval: `Max(3, 12 - difficulty * 1.0)` seconds (`BANDIT_SPAWN_INTERVAL` = 12, minimum 3s)
- Spawn from the right side of the screen
- Pick a random unmanned mount as target
- If no unmanned mounts → skip spawn

### Key Blueprint Nodes
- **Switch on Enum** (EBanditState in Tick)
- **Lerp** + **Sin** (parabolic jump arc)
- **Timeline** (alternative to manual jump interpolation, and for death fling animation)
- **Set Timer by Event** (spawn interval)

### Web-to-UE5 Translation
The web game uses a state machine with string states checked in the update loop. The UE5 version uses an enum with a Switch node in Event Tick — same logic, visual instead of code. The parabolic jump uses the same `sin(progress * PI)` formula.

### Verify
- [ ] Bandits spawn from the right and run toward a random unmanned mount
- [ ] Jump animation follows a smooth parabolic arc over 0.4 seconds
- [ ] Landing on a mount changes its state to Bandit-occupied
- [ ] Auto-weapon on occupied mount stops firing
- [ ] No gold is deducted while bandits are on train (steal rate = 0)
- [ ] Placing crew on the mount triggers the fight
- [ ] Gunner fight lasts 0.5s then crew wins; Brawler wins instantly with shockwave AOE
- [ ] Bandit flings off the train on death
- [ ] Max 10 bandits active simultaneously
- [ ] No bandits target mounts that already have bandits

---

## Step 12: Wave System

**Goal:** Combat runs cycle through CALM, WARNING, and SURGE phases with escalating difficulty.

### What to Create
- Wave management logic on the GameMode (or a separate BP_WaveManager)

### Phase Enum
Create `EWavePhase`:
- `Calm`
- `Warning`
- `Surge`

### Variables
| Variable | Type | Default |
|---|---|---|
| `CurrentPhase` | EWavePhase | Calm |
| `PhaseTimer` | Float | 0.0 |
| `WaveNumber` | Integer | 0 |
| `CalmDuration` | Float | 5.0 |
| `WarningDuration` | Float | 3.0 |
| `SurgeDuration` | Float | 5.0 |
| `SpawnRateMultiplier` | Float | 1.0 |

### Phase Logic (Event Tick or Timer)

**Calm Phase (5s):**
1. Reduced spawn rate (0.5x multiplier)
2. Increment `PhaseTimer`
3. When timer >= `CalmDuration`: transition to Warning, reset timer

**Warning Phase (3s):**
1. Show warning UI banner ("SURGE INCOMING!" with pulsing red)
2. Briefly increase spawn rate slightly
3. Play warning sound
4. When timer >= `WarningDuration`: transition to Surge, reset timer

**Surge Phase (5s):**
1. Multiply spawn rate by 2.0x (3.5x at boss stations)
2. Screen shake active (subtle constant rumble)
3. Tint screen edge red (post-process or UI overlay)
4. When timer >= `SurgeDuration`: transition to Calm, increment `WaveNumber`, reset timer

### Escalation
After each full cycle (Calm → Warning → Surge), increase difficulty:
```
SpawnRateMultiplier = 1.0 + WaveNumber * 0.10
EnemyHPMultiplier = 1.0 + WaveNumber * 0.10
```

Station modifiers (from GAME_DOCS.md) can be stored in a **DataTable** and looked up at combat start to adjust base values.

### Key Blueprint Nodes
- **Switch on Enum** (EWavePhase)
- **Set Timer by Event** (phase transitions, or use Tick + timer variable)
- **Client Start Camera Shake** (low-intensity constant shake during surge — non-positional)
- **Play Sound 2D** (warning sound)

### Web-to-UE5 Translation
The web game manages phases with timer variables in the update loop. The UE5 version can use either Tick-based timers or UE5's built-in timer system. The escalation formulas are identical.

### Verify
- [ ] Calm phase lasts ~5 seconds with reduced spawn rate
- [ ] Warning banner appears and persists for 3 seconds
- [ ] Surge phase dramatically increases enemy spawn rate
- [ ] Screen feedback during surge (shake, red tint)
- [ ] Cycle repeats: Calm → Warning → Surge → Calm
- [ ] Each cycle is harder than the last
- [ ] Wave number displays correctly on HUD

---

## Step 13: Level-Up & Card System

**Goal:** When XP threshold is reached, pause combat and present 3 upgrade cards.

### What to Create
- **WBP_LevelUp** Widget Blueprint
- Card generation logic (on GameMode)

### Trigger
In combat Tick or on enemy kill:
1. Check: `CurrentXP >= CurrentLevel * 80`
2. If true: increment `CurrentLevel`, call `ChangeState(LevelUp)`

### Card Generation — GenerateCards() returns Array of Structs
Define a **S_LevelUpCard** struct:
| Field | Type |
|---|---|
| `CardType` | Enum (CrewGunUpgrade, NewAutoWeapon, UpgradeAutoWeapon, Shield, Regen, Repair) |
| `TargetCrewIndex` | Integer |
| `WeaponType` | Enum |
| `DisplayName` | String |
| `Description` | String |
| `IconTexture` | Texture2D |

**Logic:**
1. Build eligible card pool:
   - For each crew: if `WeaponLevel < 5` → add CrewGunUpgrade card
   - If auto-weapon count < 2 → add NewAutoWeapon cards (Turret, Auto Laser, Laser)
   - For each equipped auto-weapon: if level < 5 → add UpgradeAutoWeapon card
   - If defense slots < 2 → add Shield, Regen cards
   - Always add Repair card
2. Randomize the pool using a Fisher-Yates shuffle (see note below), then pick the first 3 (or fewer if pool is small)

### WBP_LevelUp Widget Layout
- Dark semi-transparent overlay
- 3 card slots horizontally centered
- Each card: icon on top, name in bold, description below
- Hover: card scales up 10%
- Click: apply upgrade, play confetti, return to Running

### Weapon Acquire Fanfare
When a new auto-weapon is acquired (not an upgrade):
1. Don't return to Running immediately
2. Show black bars (cinematic letterbox) + weapon name text centered
3. Play powerup sound
4. **Delay** 1.5s
5. Then transition to `PlaceWeapon` state (not Running)

### Apply Upgrade — Custom Event: ApplyCard(Card: S_LevelUpCard)
Switch on CardType:
- **CrewGunUpgrade:** increment crew's `WeaponLevel` by 1
- **NewAutoWeapon:** set `PendingWeaponType`, go to PlaceWeapon state
- **UpgradeAutoWeapon:** increment the mount's `AutoWeaponLevel` by 1
- **Shield:** occupy a defense slot with Shield, increment shield level
- **Regen:** occupy a defense slot with Regen, increment regen level
- **Repair:** add 30 HP to train immediately

### Key Blueprint Nodes
- **Create Widget** (WBP_LevelUp, once, reuse)
- **Set Game Paused** = true (freeze combat)
- **Fisher-Yates shuffle** — UE5 Blueprints have no built-in Shuffle node. Implement with a **For Loop** (from LastIndex down to 1), **Random Integer in Range** (0 to current index), and **Swap** (array element at current index with element at random index). Alternatively, pick 3 random indices without replacement using **Random Integer in Range** + **Remove Index**.
- **Play Animation** (UMG animation for card hover/select)
- **Delay** (fanfare timing)
- **Spawn Emitter at Location** (confetti on card select)

### Web-to-UE5 Translation
The web game generates cards as plain objects and renders them on canvas. In UE5, cards are structs displayed via a UMG widget. The pause uses SetGamePaused. The card pool filtering logic is identical.

### Verify
- [ ] Level-up triggers at correct XP thresholds (level 1→2 at 80 XP, ~7 kills)
- [ ] 3 cards displayed with correct names and descriptions
- [ ] Cards respect constraints (no gun upgrade if already Lv5, no 3rd auto-weapon)
- [ ] Clicking a card applies the upgrade immediately
- [ ] Repair instantly heals 30 HP
- [ ] New weapon acquisition shows fanfare then transitions to PlaceWeapon
- [ ] Confetti plays on card selection
- [ ] Game unpauses after selection (or after weapon placement)
- [ ] Repair card is always available as an option

---

## Step 14: Zone Map & World Structure

**Goal:** A zone map showing stations connected by routes, where players spend coal to travel.

### What to Create
- **WBP_ZoneMap** Widget Blueprint
- **UZoneData** struct and generation logic
- **WBP_WorldMap** Widget Blueprint (for world selection)

### Data Structures

**S_Station struct:**
| Field | Type |
|---|---|
| `StationType` | Enum (Start, Combat, Empty, Exit) |
| `Position` | Vector2D (for map layout) |
| `IsVisited` | Bool |
| `IsRevealed` | Bool |
| `ConnectedStations` | Array of Integer (indices) |

**S_Zone struct:**
| Field | Type |
|---|---|
| `Stations` | Array of S_Station |
| `ZoneNumber` | Integer |
| `DifficultyMultiplier` | Float |

### Zone Generation (on GameMode or a function library)
1. Create START station at left
2. Create 2-3 route branches:
   - Short route: 2 combat stations
   - Long route: 4-5 combat/empty stations
3. Cross-connect stations at similar X positions (35% chance)
4. Create EXIT station at right
5. Reveal START and its neighbors

### WBP_ZoneMap Widget
1. **Canvas Panel** as root (allows absolute positioning of station icons)
2. For each station: create a **Button** widget at the station's position
   - Visited: solid icon
   - Revealed but unvisited: outlined icon, clickable
   - Unrevealed: hidden or fog
3. Draw connection lines between stations using **Paint** event or **Line** widgets
4. Top bar: coal counter, gold counter, zone/world indicator

### Travel Logic
When player clicks a revealed, unvisited station:
1. Check: `Coal >= 1`. If no → show "Not enough coal" feedback.
2. Deduct 1 coal
3. Mark station as visited
4. Reveal adjacent stations
5. If station type == Combat → transition to Setup state
6. If station type == Empty → mark as cleared, stay on map
7. If station type == Exit → trigger zone complete

### World Structure
- 3 worlds, each with its own zone
- **WBP_WorldMap**: linear display of 3 worlds with difficulty indicators
- Each world applies a difficulty multiplier to all combat in its zones
- World 1: 1.0x, World 2: 1.5x, World 3: 2.0x (see GAME_DOCS.md for exact values)

### Key Blueprint Nodes
- **Canvas Panel** + **Canvas Panel Slot** (absolute positioning for stations)
- **Create Widget** dynamically for each station button
- **On Clicked** (button event for station selection)
- **Draw Line** (in Paint event for connections)
- **Branch** (coal check before travel)

### Web-to-UE5 Translation
The web game renders the zone map on a 2D canvas with click detection. In UE5, the zone map is a UMG widget with buttons for each station and lines for connections. The procedural generation logic is identical — generate the graph data, then visualize it.

### Verify
- [ ] Zone map displays stations with correct types (combat icon, empty dash, exit star)
- [ ] Only revealed stations are visible
- [ ] Clicking a station deducts 1 coal and reveals neighbors
- [ ] Combat stations trigger the Setup → Running flow
- [ ] Empty stations clear immediately
- [ ] Exit station triggers zone completion
- [ ] Coal counter updates correctly
- [ ] Cannot travel with 0 coal
- [ ] Routes vary between playthroughs (procedural)
- [ ] Cross-connections appear sometimes (roughly 35%)

---

## Step 15: Shop & Persistence

**Goal:** Between-zone shop where players spend gold on permanent upgrades, with save/load.

### What to Create
- **WBP_Shop** Widget Blueprint
- **BP_TrainSaveGame** (extends SaveGame)
- Save/load logic on **GameInstance**

### WBP_Shop Layout
- 3 upgrade rows, each containing:
  - Icon (left)
  - Name + description (center)
  - Level pips (filled/empty circles showing current/max level)
  - Cost text (right)
  - Buy button (right, disabled if can't afford or maxed)
- Coal purchase row at bottom: "Buy 2 Coal — 30g"
- Navigation buttons: "Map" (return to zone map), "Next Zone" (if zone complete)

### Shop Upgrades (see GAME_DOCS.md for all values)

| Upgrade | Cost/Level | Max Level | Effect Per Level |
|---|---|---|---|
| Damage | 40 | 5 | +15% weapon damage |
| Kick Force | 40 | 5 | Increases Brawler kick AOE damage/radius |
| Max HP | 30 | 5 | +25 max HP |

> **Removed upgrades:** Shield, Cool-off, Range, Greed, and Crew Slots have been removed from the shop. Crew (Rex and Kit) are both available from the start with no unlock cost.

### Buy Logic
On buy button clicked:
1. Look up cost from the upgrade's `Cost` field (flat cost per level)
2. Check: `Gold >= Cost` AND `CurrentLevel < MaxLevel`
3. If valid: deduct gold, increment level, update display
4. Refresh all buttons (some may become affordable/unaffordable)

### BP_TrainSaveGame
Create a Blueprint extending **SaveGame** (right-click > Blueprint Class > search "Save Game"):

**Variables:**
| Variable | Type |
|---|---|
| `Gold` | Integer |
| `Coal` | Integer |
| `MaxCoal` | Integer |
| `UpgradeLevels` | Map (String → Integer) |
| `MusicVolume` | Float |
| `SfxVolume` | Float |

### Save/Load (on GameInstance Blueprint)

**SaveGame():**
1. **Create Save Game Object** (class: BP_TrainSaveGame)
2. Copy all current values into the save object
3. **Save Game to Slot** (slot name: "TrainDefense", user index: 0)

**LoadGame():**
1. **Does Save Game Exist** (slot: "TrainDefense")
2. If yes: **Load Game from Slot** → cast to BP_TrainSaveGame → copy values to GameInstance
3. If no: use defaults

**When to save:** On shop exit, on world complete, on settings change.
**When to load:** On game start (Event Init in GameInstance).

### Applying Upgrades
At the start of each combat run (Setup state):
1. Get upgrade levels from GameInstance
2. Apply to train: `MaxHP = 150 + maxHpLevel * 25`
3. Store multipliers for combat use: `DamageMultiplier = 1.0 + damageLvl * 0.15`
4. Apply kick force upgrade to Brawler kick damage/radius

### Key Blueprint Nodes
- **Create Save Game Object**
- **Save Game to Slot** / **Load Game from Slot**
- **Does Save Game Exist**
- **Cast To** BP_TrainSaveGame
- **Get Game Instance** (access persistent data from anywhere)
- **Set Text** (update cost/level displays)
- **Set Is Enabled** (disable buy buttons when can't afford)

### Web-to-UE5 Translation
The web game uses `localStorage` for persistence and an in-memory `save` object. In UE5, the GameInstance holds runtime state (persists across levels but not across sessions) and SaveGame handles disk persistence. The shop upgrade formulas are identical.

### Verify
- [ ] All 3 upgrades display with correct costs and level pips (Damage, Kick Force, Max HP)
- [ ] Buying an upgrade deducts gold and increments level
- [ ] Cost per level: Damage = 40g, Kick Force = 40g, Max HP = 30g
- [ ] Can't buy past max level (5) or without enough gold
- [ ] Coal purchase works (30g → 2 coal)
- [ ] Saving works: close game, reopen, gold and upgrades persist
- [ ] Upgrades apply in combat (e.g., +15% damage per damage level)
- [ ] Settings (volumes) persist across sessions

---

## Step 16: Coins & Economy

**Goal:** Coins spawn during combat, magnets collect all coins, and gold flows into the economy.

### What to Create
- **BP_Coin** Actor Blueprint (pool of 30)
- **BP_Magnet** Actor Blueprint (pool of 3)
- **BP_FlyingCoin** (pool of 30, for the collection animation)

### BP_Coin — Components
1. **Cylinder Mesh** (gold material, small — placeholder disc)
2. **Sphere Component** (collision, slightly larger than mesh for easy collection)

### BP_Coin — Bob Animation
In Event Tick (when active):
1. Get **Game Time in Seconds**
2. `BobOffset = Sin(GameTime * 3) * 200` (bob up/down 200 cm)
3. **Set Relative Location** on mesh: Z = BobOffset

### Coin Spawner (on GameMode or subsystem)
Timer every 3 seconds (+/- 30% random variation):
1. Roll: 8% chance → spawn magnet instead of coin
2. Pick random position within camera view (but not overlapping train)
3. Acquire coin from pool, activate at position

### Magnet Behavior
When any projectile hits the magnet (OnComponentBeginOverlap):
1. Get all active coins from the coin pool
2. For each active coin: convert to a **BP_FlyingCoin**
   - Deactivate the static coin
   - Activate a flying coin at that position
3. Flying coin lerps toward the gold HUD counter position over 0.5s
4. On arrival: add gold, deactivate flying coin

### Flying Coin — Movement
1. On activate: store start position and HUD target position
2. Event Tick:
   - `Progress += DeltaSeconds * 2.0` (0.5s travel)
   - Use **Ease** (EaseIn) for acceleration effect
   - **Lerp** between start and target using eased progress
   - **Project World to Screen** to get the HUD gold counter's world-space target
3. When Progress >= 1.0: add gold value, play coin sound, deactivate

### Gold Calculation
```
GoldGained = CoinValue * CargoMultiplier * StationCoinMult
CargoMultiplier = 1.0 + CargoBoxes * 0.25
```

### Key Blueprint Nodes
- **Sin** (bob animation)
- **Game Time in Seconds**
- **Lerp** + **Ease** (flying coin animation)
- **Project World to Screen** (find HUD target position)
- **Set Timer by Event** with random variation (coin spawn interval)
- **Get All Actors of Class** (find all active coins for magnet)

### Web-to-UE5 Translation
The web game handles coin collection by checking projectile-coin distance each frame. In UE5, use overlap events on the coin's sphere component. The flying coin animation uses the same lerp-to-HUD approach, but you need **Project World to Screen** to find the HUD counter position in screen space.

### Verify
- [ ] Coins spawn every ~3 seconds during combat
- [ ] Coins bob up and down smoothly
- [ ] 8% of spawns are magnets instead of coins
- [ ] Shooting a magnet collects ALL active coins
- [ ] Coins fly toward the HUD gold counter with acceleration
- [ ] Gold value matches: 10 * cargo multiplier * station coin multiplier
- [ ] Coin pickup sound plays on collection
- [ ] Max 30 coins and 3 magnets active simultaneously
- [ ] Flying coins deactivate correctly after reaching HUD

---

## Step 17: Audio Implementation

**Goal:** Complete audio system with music, SFX, and synthesized sounds.

### Sound Class Hierarchy
In the UE5 editor, create Sound Classes:
```
Master
  ├── Music (volume controlled by MusicVolume setting)
  │   └── SC_BackgroundMusic
  └── SFX (volume controlled by SfxVolume setting)
      ├── SC_Shoot, SC_EnemyHit, SC_EnemyKill
      ├── SC_TrainDamage, SC_Powerup
      ├── SC_CoinPickup, SC_StealLoop
      └── SC_LevelUp, SC_ZoneComplete, SC_WinWorld, SC_Defeat
```

Create a **Sound Mix** that controls the Master class. Apply volume changes via **Set Sound Mix Class Override**.

### Import Audio Files
Import these existing files as USoundWave assets:
- `music.mp3` → looping background music
- `coin.mp3` → coin pickup
- `steal.mp3` → bandit stealing (loop)
- `levelup.mp3` → level-up trigger
- `zonecomplete.mp3` → zone cleared
- `winworld.mp3` → world beaten
- `loose.mp3` → player death

### Background Music
1. Add an **Audio Component** to the GameMode (or a persistent audio manager actor)
2. Set Sound: `SC_BackgroundMusic`
3. Set looping: true
4. Start/stop based on game state:
   - Play during Running, ZoneMap, Shop
   - Stop during StartScreen, Settings

### One-Shot SFX
Use **Play Sound 2D** for UI and non-positional sounds:
- Coin pickup, level-up, zone complete, win, death

Use **Play Sound at Location** for world-positioned sounds:
- Weapon fire (at mount position)
- Enemy hit (at enemy position)
- Enemy kill (at enemy position)

### MetaSounds (Synthesized SFX)
Create MetaSound Sources for these sounds (replace placeholder Sound Cues later):

| Sound | Approach |
|---|---|
| Shoot | Oscillator (square wave) 800→200Hz sweep, 60ms ADSR |
| Enemy Hit | Oscillator (sine) 300→80Hz sweep, 100ms ADSR |
| Enemy Kill | Noise burst + oscillator (square) 600→100Hz, layered |
| Train Damage | Oscillator (sine) 120→30Hz + noise layer, 300ms |
| Powerup | Oscillator (triangle) 800→1200Hz step, 300ms |

### Volume Control
In settings, when player adjusts a slider:
1. **Set Sound Mix Class Override** on the appropriate Sound Class
2. Store volume in GameInstance → save to SaveGame

### Key Blueprint Nodes
- **Play Sound 2D** (non-positional SFX)
- **Play Sound at Location** (world-space SFX)
- **Set Sound Mix Class Override** (volume control)
- **Audio Component** > **Play** / **Stop** (background music)
- **Spawn Sound 2D** (returns audio component for control, useful for steal loop)

### Web-to-UE5 Translation
The web game uses the Web Audio API with oscillators and gain nodes. MetaSounds is the direct equivalent — a node-based audio graph. For imported MP3 files, UE5's import is straightforward. The web game's separate `musicGain` / `sfxGainNode` becomes Sound Class volume control.

### Verify
- [ ] Background music loops during gameplay
- [ ] Music stops in menus where appropriate
- [ ] Weapon fire, hit, and kill sounds play at correct positions
- [ ] Coin pickup sound plays on collection
- [ ] Steal loop starts/stops correctly with bandit stealing
- [ ] Level-up, zone complete, world win, and death sounds play at correct moments
- [ ] Volume sliders in settings affect the correct sound groups
- [ ] Volume persists across sessions (saved)
- [ ] No audio pops or clicks on sound start/stop

---

## Step 18: UI/HUD (UMG)

**Goal:** All UI screens as UMG Widget Blueprints with correct layout and information.

### Widget List

| Widget | Purpose | Shown During |
|---|---|---|
| `WBP_GameHUD` | HP bar, gold, coal, wave phase, distance, crew panel | Running, Setup |
| `WBP_ZoneMap` | Station graph with travel controls | ZoneMap |
| `WBP_Shop` | Upgrade purchase screen | Shop |
| `WBP_LevelUp` | 3 card selection | LevelUp |
| `WBP_Settings` | Volume sliders, debug toggles | Settings |
| `WBP_Pause` | Resume, restart, quit buttons | RunPause |
| `WBP_GameOver` | Result screen (4 variants) | GameOver |
| `WBP_StartScreen` | Title, buttons | StartScreen |
| `WBP_WorldMap` | World selection | WorldSelect, WorldMap |

### WBP_GameHUD Layout
- **Top bar:** HP progress bar (red→green), gold counter, coal counter, wave phase indicator
- **Left side:** distance progress bar (how far until station end)
- **Bottom-left:** 3 rows:
  - Crew row: 2 crew icons (colored circles) with weapon level indicators and role badge
  - Weapon row: equipped auto-weapon icons with level
  - Defense row: equipped defense icons with level
- **Bandit alert:** red pulsing banner at top-center ("BANDITS ON TRAIN!")
- **Idle crew hint:** orange indicator near empty mounts when crew is unassigned

### WBP_GameOver — 4 Variants
Use a single widget with dynamic content:
1. **Combat Win:** "STATION CLEARED!" + Continue button
2. **Zone Complete:** "DELIVERED!" + gold/coal summary + Shop button + Next Zone button
3. **World Complete:** "WORLD COMPLETE!" + fireworks + bonus gold display + Continue button
4. **Death:** "TRAIN DESTROYED" + Restart button

Set variant via a function that shows/hides sections and changes the title text.

### CommonUI Input Routing
Add **CommonUI** to prevent input bleed:
1. Make menu widgets extend **Common Activatable Widget**
2. When a menu opens, it captures input focus
3. Gameplay input is blocked until the menu is deactivated

### Key Blueprint Nodes
- **Progress Bar** (HP, XP, distance)
- **Text Block** (labels, counters)
- **Image** (icons)
- **Button** (interactive elements)
- **Overlay** / **Canvas Panel** (layering)
- **Play Animation** (pulsing bandit alert, card hover effects)
- **Bind Widget** (connect variable to widget for easy access in Blueprint)

### Web-to-UE5 Translation
The web game draws all UI directly on a 2D canvas with `fillText`, `fillRect`, etc. In UE5, each screen is a separate Widget Blueprint designed in the UMG visual editor. Data binding replaces the per-frame draw calls — widgets update only when their bound values change.

### Verify
- [ ] HUD shows HP, gold, coal, distance, wave phase during combat
- [ ] Crew panel shows all unlocked crew with weapon levels
- [ ] Bandit alert appears when bandits are stealing
- [ ] All 4 game over variants display correctly with appropriate buttons
- [ ] Menu navigation works with both mouse and keyboard
- [ ] CommonUI prevents input from reaching gameplay during menus
- [ ] No UI elements overlap incorrectly at different aspect ratios

---

## Step 19: Start Screen

**Goal:** A polished title screen matching the web game's aesthetic.

### Layout
- **Background:** Dark radial gradient (center slightly lighter, edges dark)
- **No dust particles** (removed from the game — do not create NS_DustParticles for this screen)
- **3D Train model:** Centered, slowly rotating (1 rotation every 20 seconds)
- **Title:** "TRAIN DEFENSE" — golden color (#FFD700 equivalent), large bold text (equivalent to 64pt)
- **No subtitle, no silhouette boxes**

### 3 Buttons (stacked vertically, centered)
1. "Start Game" → transitions to WorldSelect
2. "Power Ups" → transitions to Shop
3. "Settings" → transitions to Settings

All buttons share the same golden style with dark background, matching the title color.

### Rotating Train
1. Place a `BP_Train` (or a simplified display-only version) in the level
2. In its Tick: **Add Actor Local Rotation** Yaw = `DeltaSeconds * 18` (360/20 = 18 deg/sec)
3. Position it so the camera sees it behind/below the UI

### Key Blueprint Nodes
- **Add Actor Local Rotation** (train spin)
- **Create Widget** + **Add to Viewport** (start screen)
- **On Clicked** (button events → state transitions)

### Verify
- [ ] Title text reads "TRAIN DEFENSE" in golden color
- [ ] 3D train rotates slowly in the background
- [ ] No dust particles on the start screen
- [ ] 3 buttons are visible: Start Game, Power Ups, Settings
- [ ] Each button navigates to the correct state
- [ ] No subtitle text or silhouette boxes present
- [ ] Dark radial gradient background visible

---

## Step 20: Visual Effects & Polish

**Goal:** Particle effects, screen feedback, and material polish to match (and enhance) the web game's feel.

### Niagara Systems to Create

| System | Trigger | Description |
|---|---|---|
| `NS_Confetti` | Level-up card selection, zone complete | Colorful paper bits falling from top |
| `NS_Fireworks` | World complete | Bursts of colored sparks at random positions |
| `NS_MuzzleFlash` | Weapon fire | Brief bright flash at mount position |
| `NS_DamageParticles` | Enemy hit | Small debris/sparks at impact point |
| `NS_GarlicAura` | Brawler garlic AOE active | Continuous ring matching garlic radius (5000 cm) |
| `NS_CoinSparkle` | Coin spawn | Subtle glint on coin surface |

### Screen Shake
Create multiple **MatineeCameraShake** assets:
- `CS_TrainDamage`: 0.2s, moderate amplitude (train takes hit)
- `CS_SurgeRumble`: 8s, low amplitude, looping (during surge phase)
- `CS_BigHit`: 0.1s, high amplitude (boss kill or large damage)

Trigger with **Play World Camera Shake** at the appropriate moments.

### Damage Flash (Post-Process)
1. Create a **Post Process Material** that tints the screen white
2. Add a `FlashIntensity` scalar parameter (0 = no flash, 1 = full white)
3. On train damage:
   - Set `FlashIntensity` = 0.3
   - **Timeline** over 0.15s: lerp back to 0
4. Apply via **Post Process Volume** (unbound, so it covers everything)

### Dynamic Materials for Enemies
1. Create a base enemy material with parameters:
   - `BaseColor` (Vector) — tier-based color
   - `FlashAmount` (Scalar) — 0 to 1, lerp to white
   - `EmissiveStrength` (Scalar) — for glow effects
2. On enemy activate: **Create Dynamic Material Instance**, set `BaseColor` for tier
3. On hit: set `FlashAmount` = 1, then lerp back to 0 over 0.1s
4. On kill: brief emissive pulse before deactivation

### Weapon Glow
Auto-weapons on mounts should have a subtle glow:
- Turret: blue emissive
- Auto Laser: orange emissive
- Laser: green emissive
- Use emissive material parameter, pulsing via sine wave in material or Blueprint

### Key Blueprint Nodes
- **Spawn System at Location** (Niagara one-shot effects)
- **Activate Niagara Component** / **Deactivate** (continuous effects)
- **Play World Camera Shake**
- **Create Dynamic Material Instance** + **Set Scalar Parameter** / **Set Vector Parameter**
- **Set Post Process Settings** (on camera or post process volume)
- **Timeline** (for all timed visual transitions)

### Web-to-UE5 Translation
The web game uses canvas-based effects (screen flash overlay, CSS-like animations for damage numbers). UE5 replaces these with post-process materials (screen flash), Niagara (particles), camera shake assets (screen rumble), and dynamic material instances (per-object visual changes). The trigger points are identical.

### Verify
- [ ] Confetti spawns on level-up selection and zone complete
- [ ] Fireworks play on world complete
- [ ] Muzzle flash visible when weapons fire
- [ ] Enemy hit sparks visible at impact point
- [ ] Brawler garlic AOE has a visible aura ring matching its radius
- [ ] Screen flashes briefly white when train takes damage
- [ ] Screen shakes on train damage and during surge
- [ ] Enemies flash white on hit
- [ ] Auto-weapons glow with their type-appropriate color
- [ ] All effects deactivate cleanly (no lingering particles)

---

## Coordinate System & Scale

### Axis Conversion

```
Three.js (Y-up, right-handed)    →    UE5 (Z-up, left-handed)

UE5.X =  ThreeJS.X × 100    (forward)
UE5.Y = -ThreeJS.Z × 100    (right, negated)
UE5.Z =  ThreeJS.Y × 100    (up)
```

### Scale Reference

| Concept | Web (px) | UE5 (cm) at x100 | Notes |
|---|---|---|---|
| Train car width | 32 | 3,200 | May be too large — consider x10 instead |
| Enemy radius | 6 | 600 | |
| Weapon range | 220 | 22,000 | |
| Canvas width | 960 | 96,000 | |
| Train speed | 167/sec | 16,700/sec | |

**Important:** Direct x100 conversion may result in very large UE5 units. Consider using x10 (1 web pixel = 10 cm) for a more manageable scale. The critical thing is **consistency** — pick one factor and apply it everywhere.

### Rotation
- Web: radians, standard math angles (0 = right, PI/2 = up)
- UE5: `FRotator(Pitch, Yaw, Roll)` in degrees
- Conversion: `Degrees = Radians * (180 / PI)`
- Yaw in UE5 = angle from forward (X-axis), clockwise when viewed from above

---

## Asset Pipeline

### 3D Models

| Asset | Source | UE5 Format | Import Notes |
|---|---|---|---|
| Train (4 cars) | Train.fbx | Static Mesh | Check scale (x100), verify pivot points |
| Enemy zombie | enemy.fbx | Static Mesh | Need LOD for 150 on-screen |
| Weapons | Gun.fbx, AutoGun.fbx, Laser.fbx, Garlic.fbx | Static Mesh | Attach to mount sockets |
| Rail/track | Rail.fbx | Static Mesh | Tiling/instanced for scrolling |
| Bandit | New asset needed | Static Mesh | Web uses procedural box geometry |
| Crew | New asset needed | Static Mesh | Web uses colored spheres |
| Coins | New: simple disc | Static Mesh | Gold cylinder with material |

### Audio Files

| File | Type | Import As |
|---|---|---|
| music.mp3 | Background loop | USoundWave, set looping |
| coin.mp3 | One-shot SFX | USoundWave |
| steal.mp3 | Looping SFX | USoundWave, set looping |
| levelup.mp3 | One-shot SFX | USoundWave |
| zonecomplete.mp3 | One-shot SFX | USoundWave |
| winworld.mp3 | One-shot SFX | USoundWave |
| loose.mp3 | One-shot SFX | USoundWave |

### FBX Import Checklist
1. Check scale: Three.js models are in meters, UE5 uses centimeters
2. Check pivot points: Three.js centers at geometry center; UE5 expects pivot at "feet"
3. Check axis: Y-up in Three.js vs Z-up in UE5 (usually auto-converted)
4. Check normals: verify faces aren't flipped after import

---

## Tuning Constants

All gameplay values are documented in **GAME_DOCS.md**. For the UE5 port, store them in one of these containers:

### Recommended: DataAsset Approach
Create a `DA_GameConstants` Primary Data Asset with categorized variables:

```
DA_GameConstants
├── Train
│   ├── MaxHP (Float) = 150
│   ├── Speed (Float) = 16700
│   ├── TargetDistance (Float) = 1000000
│   └── ...
├── Weapons
│   ├── ManualGunLevels (Array of Struct)
│   ├── TurretLevels (Array of Struct)
│   ├── AutoLaserLevels (Array of Struct)
│   └── LaserLevels (Array of Struct)
├── Enemies
│   ├── BaseHP, BaseSpeed, etc.
│   └── TierMultipliers (Array)
├── Economy
│   ├── CoinValue, XPPerKill, etc.
│   └── ShopUpgrades (Array of Struct)
└── Pools
    ├── MaxEnemies = 150
    ├── MaxProjectiles = 300
    └── ...
```

### Alternative: DataTable Approach
Use DataTables for per-level weapon stats (rows = levels, columns = stats). Good for weapon balancing since you can edit them in a spreadsheet-like view.

### Access Pattern
1. Store a reference to `DA_GameConstants` on the GameMode
2. Any Blueprint that needs a constant: **Get Game Mode** → **Cast to GM_TrainDefense** → access the DataAsset reference
3. Never hardcode gameplay values in individual Blueprints

---

## Common Pitfalls

### Architecture
- **Don't replicate the central game loop.** In UE5, each Actor updates itself via Tick. If you try to write one big `updateAll()` function, you will fight the engine.
- **Don't use strings for state/type checks.** Use UENUM types. Strings are slow and typo-prone.
- **Don't call Destroy() on pooled actors.** Always return them to the pool. Destroying a pooled actor breaks the pool permanently.

### Coordinates
- **Y-up to Z-up.** Every hardcoded position needs conversion.
- **Centimeter scale.** Multiply all distances by your chosen scale factor consistently.
- **Radians to Degrees.** All angle constants need conversion.
- **Right-handed to Left-handed.** Some rotation math needs a sign flip.

### Performance
- **Disable tick on inactive pooled actors.** A hidden actor with tick enabled still wastes CPU every frame.
- **Use Timers for cooldowns**, not manual per-frame countdown checks. UE5 timers are more efficient.
- **Use overlap events for range detection.** The physics system handles distance checks more efficiently than manual per-frame loops.
- **Batch UI updates.** Only update HUD text when values change, not every frame.

### UI
- **Don't create a widget per enemy health bar.** 150 separate widgets will tank performance. Use a single batched draw widget or world-space canvas approach.
- **Use CommonUI input routing.** Without it, clicking a menu button might also fire a weapon behind it.

### Assets
- **Check FBX scale on import.** Three.js models are in meters; UE5 expects centimeters.
- **Check pivot points.** Wrong pivots cause weird rotation and positioning. Three.js centers at geometry; UE5 expects pivot at origin/feet.

---

## Acceptance Criteria

Each system should be verified against the original web game:

| System | Test |
|---|---|
| Train movement | Reaches end at same relative time (10,000 / 167 = ~60s) |
| Crew damage | Manual gun Lv1 deals 12 dmg, Lv5 deals 32 dmg |
| Driver buff | Driver seat provides no damage multiplier (1.0x) |
| Enemy HP scaling | Zone 1 base enemy: 20 HP. Zone 3 boss: ~40+ HP |
| Turret burst | Lv3 fires 3 shots per burst |
| Auto Laser range | Lv1: 240px equivalent, scales with level |
| Laser bounces | Lv1: 2 bounces, Lv5: 6 bounces |
| Coin value | 10g per coin x greed multiplier |
| Bandit steal rate | 5g/sec while on unmanned mount |
| Coal consumption | 1 per hop, +2 per combat win |
| Shop costs | Damage: 40g/level, Kick Force: 40g/level, Max HP: 30g/level |
| Level-up XP | Level 1→2: 80 XP (~7 kills), Level 5→6: 480 XP (~40 kills) |
| Max crew | 2 (Rex + Kit, both available from the start) |
| Game over types | 4 distinct screens: combat win, zone complete, world complete, death |
| Object pools | 150 enemies + 300 projectiles at 60fps stable |
| Save/Load | Gold, upgrades, and volumes persist across sessions |

---

---

## Step 21: Crew Role System (Gunner / Brawler)

**Goal:** Implement the per-world role selection UI and role-specific combat behavior.

### What to Create
- **WBP_CrewRoleSelect** Widget Blueprint — shown before entering the world map
- **DA_CrewRole** Data Asset per role — stores damage multipliers, fight duration overrides, etc.
- Role-specific behavior branches on `BP_CrewMember` and `BP_Bandit`

### DA_CrewRole (Data Asset)
Create a `DA_CrewRole` Primary Data Asset with fields:

| Field | Type | Gunner Value | Brawler Value |
|---|---|---|---|
| `RoleName` | String | "Gunner" | "Brawler" |
| `DamageMultiplier` | Float | 1.6 | 0.0 (no gun) |
| `HasGun` | Bool | true | false |
| `HasGarlic` | Bool | false | true |
| `BanditFightDurationMultiplier` | Float | 2.0 | 0.0 (instant kick) |
| `KickDamage` | Float | 0.0 | 60.0 |
| `KickRadius` | Float | 0.0 | 160.0 (cm x100) |

### WBP_CrewRoleSelect — Card Selection UI
1. Create a **WBP_CrewRoleSelect** widget with a card-based layout
2. Display one crew card per crew member, each with two selectable role tiles: Gunner / Brawler
3. Show role description and stat preview on hover
4. "Confirm" button locks in choices and transitions to `WorldMap` state
5. Trigger this screen after `WorldSelect` — before entering the zone map

### Role Assignment (on BP_CrewMember)
Add a `CrewRole` variable (type: Enum `ECrewRole` with values `Gunner`, `Brawler`). On role set:
- Store reference to matching `DA_CrewRole`
- If `Brawler`: disable gun firing logic, activate garlic AOE component
- If `Gunner`: enable gun firing logic, apply `DamageMultiplier` to all projectile damage

### Blueprint Graph — SetCrewRole

```
┌──────────────────────┐     ┌──────────────────────────────┐
│ 🔴 Event SetCrewRole │────►│ 🟡 Set CrewRole Variable     │
│   Input: ECrewRole   │     │   → Store DA_CrewRole ref    │
└──────────────────────┘     └──────────────┬───────────────┘
                                            ▼
                             ┌──────────────────────────────┐
                             │ 🟣 Switch on ECrewRole       │
                             └──────┬───────────────┬───────┘
                                Gunner           Brawler
                                    │               │
                                    ▼               ▼
                      ┌─────────────────┐ ┌────────────────────────┐
                      │ 🔵 Enable Gun   │ │ 🔵 Disable Gun         │
                      │   Component     │ │   Component            │
                      │ Set DamageMult  │ │ Activate GarlicZone    │
                      │   = 1.6         │ │ Activate NS_GarlicAura │
                      └─────────────────┘ │ Set Timer: GarlicTick  │
                                          └────────────────────────┘
```

### Verify
- [ ] Role selection screen appears after world select, before world map
- [ ] Both crew cards are shown, each with Gunner/Brawler options
- [ ] Same role can be selected for both crew (e.g. 2 Brawlers)
- [ ] Role is stored per crew member and persists through the world
- [ ] Gunner crew fires projectiles with 1.6x damage multiplier
- [ ] Brawler crew shows garlic aura, does not fire projectiles
- [ ] Role resets between worlds

---

## Step 22: Brawler Garlic AOE Weapon

**Goal:** Brawler crew continuously damages nearby enemies via a sphere overlap, with knockback and an aura visual.

### What to Create
- **USphereComponent** on `BP_CrewMember` for garlic overlap detection
- Timer-based damage tick on the Brawler crew member
- **NS_GarlicAura** Niagara ring attached to mount socket

### Garlic Overlap & Damage Tick
On `BP_CrewMember`, when role == Brawler:
1. Add a **Sphere Collision Component** (`GarlicZone`), radius = 5000 cm (50 web px x 100)
2. On **BeginPlay** (when Brawler role is set): **Set Timer by Event** every 0.4s → `GarlicTick`
3. **GarlicTick** custom event:
   - **Get Overlapping Actors** on `GarlicZone`, filter to `BP_Enemy`
   - For each overlapping enemy:
     - Apply 14 damage
     - Set enemy's `KnockbackVelocity` += direction away from Brawler x 20000 (200 web units x 100). Do **not** use **Add Impulse** — enemies use manual movement, not physics. The knockback decays automatically in the enemy's Tick (see Step 5).
     - Spawn hit spark effect: **Spawn System at Location** (`NS_DamageParticles`) at enemy position

### Blueprint Graph — GarlicTick

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│ 🔴 Event GarlicTick │────►│ 🔵 Get Overlapping Actors│────►│ 🔵 For Each Loop │──┐
│                     │     │   Component: GarlicZone  │     │   Array: Enemies │  │
└─────────────────────┘     │   Class: BP_Enemy        │     └──────────────────┘  │
                            └──────────────────────────┘                            │
    ┌───────────────────────────────────────────────────────────────────────────────┘
    │  Loop Body
    ▼
┌───────────────────────┐     ┌─────────────────────────┐     ┌──────────────────────┐
│ 🔵 Apply Damage       │────►│ 🔵 Get Direction To      │────►│ 🔵 Set KnockbackVel   │
│   Damage: 14          │     │   (Enemy → Self)         │     │   += Dir × 20000      │
│   Target: Enemy       │     │   → Negate (push away)   │     │   Target: Enemy        │
└───────────────────────┘     └─────────────────────────┘     └──────────┬─────────────┘
                                                                         │
                                                                         ▼
                                                              ┌────────────────────────┐
                                                              │ 🔵 Spawn System at Loc  │
                                                              │   System: NS_HitSpark   │
                                                              │   Location: Enemy pos    │
                                                              └────────────────────────┘
```

### Garlic Aura Visual
1. Create a **Niagara System** `NS_GarlicAura`:
   - Ring shape emitter, radius matching `GarlicZone` (5000 cm)
   - Continuous loop while active
   - Subtle pulsing glow to indicate damage area
2. Attach `NS_GarlicAura` to the mount's weapon socket
3. One Niagara Component per Brawler crew member — activate when Brawler arrives at a mount, deactivate when they leave
4. No 3D weapon mesh on the mount for Brawler crew

### Key Blueprint Nodes
- **Sphere Collision Component** → **Get Overlapping Actors**
- **Set Timer by Event** (garlic tick interval)
- **Get Unit Direction Vector** + set `KnockbackVelocity` (knockback on each tick — no physics impulse)
- **Spawn System at Location** (hit sparks)
- **Activate** / **Deactivate** (Niagara Component for aura ring)

### Verify
- [ ] Garlic zone damages all enemies within 5000 cm every 0.4s
- [ ] Knockback pushes enemies away from Brawler position
- [ ] Hit sparks appear on each tick
- [ ] Aura ring is visible around Brawler's mount
- [ ] Aura disappears when Brawler leaves the mount
- [ ] No projectiles are fired from Brawler mounts

---

## Step 23: Brawler Kick Mechanic

**Goal:** Brawler crew instantly kick bandits off the train, launching them into nearby enemies for AOE damage.

### What to Create
- Kick logic on `BP_Bandit` (triggered when Brawler crew arrives at an occupied mount)
- **NS_ShockwaveEffect** Niagara system for impact visuals

### Kick Trigger
In `BP_Bandit` (Fighting state entry), check the arriving crew's role:
- **Gunner:** proceed with normal fight duration (2x base)
- **Brawler:** skip fight duration entirely, immediately call `BrawlerKick`

### BrawlerKick Custom Event (on BP_Bandit)
1. Record `KickOrigin` = current bandit world position
2. Find nearest enemy cluster: **Sphere Overlap Actors** centered on bandit, radius 10000 cm (100 web px x 100)
   - Pick the actor in the center of the cluster (or the nearest one if cluster is empty)
   - Cap flight distance: max 10000 cm
3. `KickLandingPoint` = position of target (or `KickOrigin` + max offset if no target)
4. Spawn `NS_ShockwaveEffect` at `KickOrigin`
5. Launch bandit: **Set Actor Location** + **Timeline** over 0.4s lerping from `KickOrigin` to `KickLandingPoint` (add parabolic arc via Sin)
6. On Timeline complete:
   - **UGameplayStatics::ApplyRadialDamage** centered on `KickLandingPoint`
     - Base Damage: 60, Damage Radius: 16000 cm
     - Damage Causer: the Brawler `BP_CrewMember` actor
     - Damage Type Class: `UDamageType::StaticClass()` (default)
     - Instigated By: the owning Player Controller
     - Ignore Actors: array containing the train and the bandit itself
   - Spawn `NS_ShockwaveEffect` at `KickLandingPoint`
   - Start fade-out: **Timeline** 0.3s lerping mesh opacity to 0
   - Deactivate bandit after fade

### Blueprint Graph — BrawlerKick

```
┌─────────────────────────┐     ┌──────────────────────────┐     ┌────────────────────────┐
│ 🔴 Event BrawlerKick    │────►│ 🔵 Sphere Overlap Actors │────►│ 🟣 Branch              │
│                         │     │   Position: Self         │     │   Enemies.Length > 0?   │
│   KickOrigin = GetLoc() │     │   Radius: 10000          │     └──────┬─────────┬───────┘
└─────────────────────────┘     │   Class: BP_Enemy        │          True       False
                                └──────────────────────────┘            │           │
                                                                        ▼           ▼
                                                           ┌──────────────────┐ ┌──────────────┐
                                                           │ 🔵 Find Nearest  │ │ 🟡 Default   │
                                                           │   → LandingPoint │ │   Offset     │
                                                           └────────┬─────────┘ └──────┬───────┘
                                                                    └──────┬───────────┘
                                                                           ▼
┌──────────────────────────┐     ┌───────────────────────┐     ┌────────────────────────────┐
│ 🔵 Spawn System at Loc  │◄────│ 🔵 Play Flight TL     │◄────│ 🔵 Spawn System at Loc     │
│   NS_Shockwave           │     │   Timeline: 0.4s      │     │   NS_Shockwave @ Origin    │
│   @ LandingPoint         │     │   Lerp + Sin arc      │     └────────────────────────────┘
└──────────┬───────────────┘     └───────────────────────┘
           │
           ▼
┌───────────────────────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│ 🔵 Apply Radial Damage        │────►│ 🔵 Play Fade TL (0.3s)  │────►│ 🔵 Deactivate    │
│   Origin: LandingPoint        │     │   Opacity: 1 → 0        │     │   Set Active: No │
│   Damage: 60  Radius: 16000   │     └─────────────────────────┘     └──────────────────┘
└───────────────────────────────┘
```

### NS_ShockwaveEffect
Create a Niagara system with a quick expanding ring and brief flash:
- Ring emitter expanding from 0 to 16000 cm radius over 0.2s
- High emissive burst, fades to 0 opacity

### Key Blueprint Nodes
- **Sphere Overlap Actors** (find nearby enemy cluster)
- **Timeline** (parabolic flight arc + fade-out)
- **Apply Radial Damage** (`UGameplayStatics::ApplyRadialDamage`)
- **Set Scalar Parameter** on dynamic material (fade opacity)
- **Spawn System at Location** (shockwave at origin and landing)

### Verify
- [ ] Brawler arriving at a bandit-occupied mount triggers an instant kick (no fight wait)
- [ ] Bandit flies toward nearest enemy cluster in a parabolic arc over 0.4s
- [ ] AOE damage (60 dmg, 160 radius) is applied at the landing point
- [ ] Shockwave visual plays at both kick origin and landing point
- [ ] Bandit fades out over 0.3s after landing
- [ ] Gunner crew still uses the 2x fight duration path (not instant kick)

---

## Step 24: Auto Laser Weapon

**Goal:** A projectile-firing auto-weapon that targets the nearest enemy without any cone restriction.

### What to Create
- Auto Laser firing logic on weapon mounts (extending the existing auto-weapon system from Step 9)
- Uses the Garlic 3D model (`SM_Garlic` / `Garlic.fbx`) as the mount visual

### Implementation
The Auto Laser works identically to the Turret, with two differences:

1. **No cone restriction.** When finding the nearest enemy, use a full **Sphere Overlap Actors** search — do not apply the `ConeHalfAngle` filter. Compare to Turret which restricts to a 90° arc.
2. **Single projectile per fire** (at base level). Uses the same `BP_Projectile` pool as the Turret.

In the mount's `AutoWeaponType` enum, add `AutoLaser`. In the firing Tick:
```
If AutoWeaponType == AutoLaser:
  Check cooldown (FireInterval = 1.4s base)
  FindNearestEnemy() — full sphere, no cone
  FireProjectile toward enemy with base damage 10
  Reset cooldown
```

`FindNearestEnemy()` — shared utility function:
1. **Sphere Overlap Actors** at mount position, radius = weapon range
2. Filter to active `BP_Enemy`
3. Return actor with smallest distance to mount

In `DA_WeaponStats`, add Auto Laser rows (same structure as Turret rows).

### Mount Visual
Assign `SM_Garlic` as the mount mesh when `AutoWeaponType == AutoLaser`. No separate model is needed — reuse the existing Garlic FBX from the asset pipeline.

### Verify
- [ ] Auto Laser fires projectiles at the nearest enemy every 1.4s (base)
- [ ] Targets enemies in any direction — no cone angle filter
- [ ] Turret still uses its 90° cone (Auto Laser does not affect Turret behavior)
- [ ] Garlic mesh appears on the mount when Auto Laser is equipped
- [ ] Stats scale with level (damage, interval, range)
- [ ] Auto Laser can be acquired as a level-up card and placed on a mount

---

## Step 25: Controls Legend HUD Element

**Goal:** A persistent key bindings reference displayed on the left side of the viewport during runs.

### What to Create
- **WBP_ControlsLegend** Widget Blueprint, anchored to the left side of the viewport

### Layout
- **Vertical Box** anchored to `Left Center` in the viewport
- Each row: key icon (styled box) + action label in small text
- Rows to include: Aim (WASD/Arrows), Cycle Crew (Tab), Select Crew (1/2), Pause (Space), Menu (Esc)
- Semi-transparent dark background panel

### Visibility
- Show `WBP_ControlsLegend` during `Running` and `RUN_PAUSE` states
- Hide during all other states (menus, setup, level-up, etc.)
- Add/remove in `ChangeState` alongside `WBP_GameHUD`

### Key Blueprint Nodes
- **Anchor** = Left Center (in the UMG Anchors preset)
- **Vertical Box** (rows of key + label pairs)
- **Set Visibility** (show/hide with game state)

### Verify
- [ ] Controls legend is visible on the left side during gameplay
- [ ] Legend hides during menus, setup, and level-up
- [ ] Key labels are legible without obstructing gameplay
- [ ] Tab key is listed for cycling crew selection

---

*This document should be kept alongside the source code and updated as the port progresses. Reference GAME_DOCS.md for all gameplay values and mechanics details.*
