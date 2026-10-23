# CoC7 Universal Equipment v1.4.0

Built on the working v1.3.2 inventory checkbox and light animation code.

## New controls
- Equipped light sources display remaining minutes.
- **−15m** consumes 15 minutes manually.
- **↻** refills from an actual matching supply item in the same actor inventory; one supply item is consumed.
- Medical disposables display **Use 1**, which decrements quantity. CoC7 skill rolls and healing remain manual.
- When world time advances, equipped light sources consume elapsed in-game minutes.
- A depleted light automatically unequips and its token light is restored.
- Battery/fuel replacement does not delete the light source.
- Consumable state persists as flags on the actor embedded Item.

## Setup
Install ZIP as a module folder under Foundry Data/modules, restart Foundry, enable module, then run `await game.modules.get("coc7-universal-equipment").api.install()` in console to add/update the compendium items. The module install does not overwrite World Items.

**Important:** Compendium entries do not automatically modify already embedded actor items. Existing lights work using their existing profiles; new refill supplies must be added to actor inventory. Time tracking requires a GM client online and advancing Foundry world time. The v1.4.0 clock tracking covers world actors; unlinked synthetic-token actors may need separate support. World time may advance in seconds, and manual burn is available for scenes where it does not.

No automatic medical healing is applied, to avoid bypassing CoC7 rules. Test on a duplicate world before using in a live campaign.


## v1.4.1 — GM Force Refill
GM users see an ⚡↻ button beside light-source resource counters. It restores the embedded Actor Item resource to full capacity without consuming batteries, fuel, or any other inventory items. The item remains unequipped until manually equipped. The ordinary ↻ button still requires supplies.


## v1.5.0 Conditions
GM-only dropdown on supported light items: Terrible -75%, Poor -50%, Fair -25%, Normal 0%, Good +25%, Excellent +50%. Condition is saved on the embedded Actor Item. Duration capacity is calculated from the item's base duration; changing condition preserves the fraction of resource remaining. Torches, matches, and candles cannot be refilled, including with Force Refill. Install/replace module and restart Foundry.

## v1.5.1 — condition-driven lighting
The GM-only condition dropdown now affects **bright and dim radius**, **light color intensity** (`alpha`), and **duration**. Presets:
- Terrible: 25% of base radii and duration; alpha 0.10
- Poor: 50% of base radii and duration; alpha 0.20
- Fair: 75% of base radii and duration; alpha 0.30
- Normal: 100% of base radii and duration; alpha 0.35
- Good: 125% of base radii and duration; alpha 0.45
- Excellent: 150% of base radii and duration; alpha 0.55

Example gas lantern (base 25 ft bright, 50 ft dim, 480 minutes):
Terrible 6.25/12.5 ft, 120 min; Excellent 37.5/75 ft, 720 min.
Animation presets and speed caps are unchanged. Color hue and angle remain unchanged.
Existing light state is restored when unequipped. Changing condition does not
refill the item; it preserves the percentage of resource remaining.

## v1.5.2 hotfix
Fixed condition light output: the prior build incorrectly retained fixed radii and alpha. Now condition applies to bright/dim radii and alpha, immediately syncing equipped token lighting. Requires a Foundry restart.


## v1.6.0 experimental: Usable items

- Adds **Use** to First Aid Kits, bandages, Doctor's Bags and similar items on CoC7 Gear & Cash.
- Attempts the native skill item `roll()`/`skillCheck()` if exposed. If not, directs the player to roll from the Skills tab.
- GM chat action can toggle a registered Foundry status on the selected token.
- GM Apply Healing appears only if CoC7 provides a structured success flag and the roll is linked to a pending item use. This linkage is provisional: native roll flag structure varies across CoC7 releases.
- No automatic consumable deduction, pushed-roll consequence, or healing eligibility tracking in this release.
- **Important:** v14 chat render hooks and CoC7 skill roll APIs require in-world validation. Treat this release as a test build, not a verified production update.


## v1.7.0 consumables (test build)
24 catalog entries, updating existing matching names rather than duplicating. Run `await game.modules.get("coc7-universal-equipment").api.install()` as GM after upgrading to refresh compendiums.

Native medical rolls now use `actor.skillCheck(skill.name, false, {})` as confirmed in CoC7 8.16. GM controls treatment. First Aid heals 1 HP only after eligibility confirmation. Consumables with direct HP healing are explicitly homebrew.

Temporary effect flags are stored with world-time expiration and chat notices. **Characteristic and roll modifiers are NOT yet automatically applied to CoC7 rolls**; the Keeper applies them manually pending native CoC7 Active Effect validation. Expiration removes module flags and notifies chat. Existing actor inventory copies do not automatically inherit catalog updates; reimport updated entries for testing.


## v1.7.4 — First Aid Dressing ONLY
GM selects final native roll outcome: regular/hard +1 HP/-1 dressing, extreme/critical +2/-1, failure 0/-1, fumble 0/-2, pushed (any outcome) 0/-2. No other items' treatment rules are changed. Requires selected target token for healing, GM confirmation, HP verification, and marks chat message resolved. Roll classification is GM-selected, not automatically parsed. Player must roll using the First Aid Dressing Use control so a pending attempt is linked to the actor.
