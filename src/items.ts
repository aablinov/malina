import { rng, type Rand } from './rng.ts';
import { t } from './i18n/i18n.ts';

/**
 * Items, gear and progression in the spirit of Minecraft Dungeons (wiki/design-inventory.md).
 * Four kinds of items: melee weapons (model and strikes — src/weapons.ts), ranged, armour, artifacts.
 * An item has power: damage, armour health and artifact strength grow from it. Progression is enchantments:
 * an item has 1–3 slots (by rarity), each slot offers three options; the chosen one is upgraded up to III with enchantment
 * points (1 point per hero level). Salvaging an item returns the spent points and gives raspberries.
 * Only data and rules here — no DOM and no three: the HUD and inventory (src/hud/) and the scene (src/dev/gear.ts) read from here.
 */

export type ItemSlot = 'melee' | 'ranged' | 'armor' | 'artifact' | 'aura';
export type Rarity = 'common' | 'rare' | 'unique';

export const SLOT_TITLE: Record<ItemSlot, string> = { melee: t('Melee'), ranged: t('Ranged'), armor: t('Armour'), artifact: t('Artifacts'), aura: t('Auras') };
/** Rarity: label and frame colour, as in Minecraft Dungeons */
export const RARITY: Record<Rarity, { title: string; color: string; salvage: number; slots: number }> = {
  common: { title: t('Common'), color: '#a7abb3', salvage: 1, slots: 1 },
  rare: { title: t('Rare'), color: '#3fd67a', salvage: 2, slots: 2 },
  unique: { title: t('Unique'), color: '#f59a23', salvage: 4, slots: 3 },
};

// ---------- catalog ----------

/** Boss spells (src/magic/, wiki/design-spells.md, section 3) */
export type BossSpellKind =
  | 'meteor' | 'flameserpent' | 'ashcrown' | 'icetomb' | 'frostridge' | 'absolutezero'
  | 'thunderspear' | 'thunderleap' | 'stormcloud' | 'starfall' | 'starbeam' | 'judgement'
  | 'deadchoir' | 'gravitywell' | 'skullscythe' | 'fallenguards'
  | 'rift' | 'raspberrybush' | 'titanform' | 'bladephalanx' | 'blink'
  // base ones: fire, summoning, raspberry blood, light — sold by the merchant (src/magic/base-*.ts)
  | 'firewall' | 'firestorm' | 'armageddon' | 'wolves' | 'elemental' | 'golem' | 'bloodclaws' | 'bloodswarm' | 'bloodblade' | 'blindflash';
/** Starter spells (src/magic/starters.ts) */
export type StarterSpellKind = 'spark' | 'fireball' | 'icerain' | 'heal';
/** Relic spells (src/magic/relics.ts): very strong, drop from enemies only */
export type RelicSpellKind = 'dragonbreath' | 'glacier' | 'worldstorm' | 'supernova' | 'soulstorm' | 'earthshatter' | 'bloodmoon' | 'timestop' | 'phoenix' | 'bladestorm';
/** Any spell — present in the SPELLS registry (src/magic/registry.ts) */
export type SpellKind = StarterSpellKind | BossSpellKind | RelicSpellKind;
/** What a relic weapon does on every hit by itself (src/gear.ts `relicHit`) */
export type RelicProc = 'burn' | 'chill' | 'chain' | 'leech' | 'nova' | 'expose' | 'stun' | 'souls' | 'smite' | 'quake';
export const RELIC_TEXT: Record<RelicProc, string> = {
  burn: t('Relic: every hit sets the enemy on fire'),
  chill: t('Relic: every hit chills — the enemy slows by 40 %'),
  chain: t('Relic: lightning jumps from the hit to two more enemies'),
  leech: t('Relic: every hit returns 8 % of the damage as health'),
  nova: t('Relic: every fifth hit bursts in a star wave'),
  expose: t('Relic: the hit enemy takes 30 % more damage'),
  stun: t('Relic: one hit in five stuns'),
  souls: t('Relic: +3 souls per hit and a little health'),
  smite: t('Relic: one hit in four calls a beam from the sky'),
  quake: t('Relic: one hit in four shakes the ground and stuns around'),
};
/** Artifacts without a cast: they fire in src/gear.ts */
export type PlainArtifactKind = 'firework' | 'totem' | 'boots' | 'horn' | 'harvester' | 'lightning';
export type ArtifactKind = PlainArtifactKind | SpellKind;
export type PerkKind = 'souls' | 'artifactDmg' | 'cooldown' | 'meleeDmg' | 'rangedDmg' | 'speed' | 'potion' | 'roll' | 'arrows';

export interface Perk { kind: PerkKind; value: number }

export const PERK_TEXT: Record<PerkKind, (v: number) => string> = {
  souls: (v) => t('+{v}% souls gathered', { v }),
  artifactDmg: (v) => t('+{v}% artifact damage', { v }),
  cooldown: (v) => t('−{v}% artifact cooldown', { v }),
  meleeDmg: (v) => t('+{v}% melee damage', { v }),
  rangedDmg: (v) => t('+{v}% arrow damage', { v }),
  speed: (v) => t('+{v}% movement speed', { v }),
  potion: (v) => t('+{v}% potion healing', { v }),
  roll: (v) => t('−{v}% dodge roll cooldown', { v }),
  arrows: (v) => t('+{v} arrows per bundle', { v }),
};

export interface RangedStats {
  /** Arrow damage at power 1 */
  dmg: number;
  /** Pause between shots, s */
  cd: number;
  /** Arrow speed, m/s */
  speed: number;
  /** Range, m */
  range: number;
  /** Arrows per shot (fan) */
  shots?: number;
  knock: number;
}

/** How armour looks on the hero (Knight.setArmor): colours and details */
export interface ArmorLook {
  /** Breastplate and sleeves */
  body: string;
  /** Belt, collar, trim */
  trim: string;
  /** Pauldrons */
  pauldron?: string;
  /** Headgear: hood, helmet, cap, wolf head */
  head?: { kind: 'hood' | 'helmet' | 'cap' | 'wolf'; color: string; accent?: string };
  /** Skirt below the belt (robe) */
  skirt?: string;
  /** Cape colour */
  cape?: string;
  /** Glowing stone on the chest */
  glow?: string;
}

/** How the bow looks in the hand when shooting (Knight.setBow) */
export interface BowLook { kind: 'bow' | 'crossbow'; wood: string; string: string; glow?: string; size?: number }

export interface ArtifactStats {
  kind: ArtifactKind;
  /** Cooldown, s */
  cd: number;
  /** Damage or healing at power 1 */
  power: number;
  /** Effect radius, m */
  radius?: number;
  /** Effect duration, s */
  duration?: number;
  /** Souls it spends */
  souls?: number;
  /** Spell: full charge time, s (hold the key — stronger) */
  charge?: number;
  /** Property line on the card: {v} — power with the item, {r} — radius, {d} — duration */
  info?: string;
}

/** Auras (wiki/design-spells.md, section 4): always on, the meter gives a flare ×3 */
export type AuraKind = 'pact' | 'bastion' | 'rage' | 'clarity' | 'thorns' | OffenseKind;
/** Offensive auras (src/aura-offense.ts): strike enemies around the hero on their own */
export type OffenseKind = 'inferno' | 'frost' | 'storm' | 'halo' | 'shade' | 'quake' | 'blades';
export interface AuraStats {
  kind: AuraKind;
  /** Effect strength, % at item power 1; for offensive ones — damage per tick (for "Hungry Shade" — % of weakening) */
  value: number;
  /** Radius: allies inside get the effect, m */
  radius: number;
}

export interface ItemDef {
  id: string;
  slot: ItemSlot;
  title: string;
  rarity: Rarity;
  /** Icon from src/icons.ts */
  icon: string;
  description: string;
  /** Melee: weapon id in src/weapons.ts */
  weapon?: string;
  ranged?: RangedStats & { look: BowLook };
  /** Armour: health at power 1, special perks and the look on the hero */
  armor?: { health: number; perks: Perk[]; look: ArmorLook };
  artifact?: ArtifactStats;
  aura?: AuraStats;
  /**
   * Spell (wiki/design-spells.md): starter; 'shop' — common, the merchant sells it for raspberries; 'boss' — rare and above, boss drops only.
   * Never appears in chests or in random stock
   */
  spell?: 'starter' | 'shop' | 'boss' | 'mob';
  /** A relic (wiki/design-inventory.md): drops from enemies only — not in chests, shops or the starter kit */
  mob?: true;
  /** A relic weapon's own effect on every hit */
  relic?: RelicProc;
  /** Special weapon traits (lines as in MCD: "Wide strikes") */
  traits?: string[];
}

const A = (kind: ArtifactKind, cd: number, power: number, more: Partial<ArtifactStats> = {}): ArtifactStats => ({ kind, cd, power, ...more });

export const ITEMS: readonly ItemDef[] = [
  // melee — models and strikes in src/weapons.ts
  { id: 'sword', slot: 'melee', weapon: 'sword', title: t('Warden sword'), rarity: 'common', icon: 'sword', description: t('A trusty blade every journey begins with.'), traits: [t('Three-hit combo')] },
  { id: 'axe', slot: 'melee', weapon: 'axe', title: t('Woodcutter axe'), rarity: 'common', icon: 'axe', description: t('Chops firewood and whoever hides behind it.'), traits: [t('Strong knockback')] },
  { id: 'mace', slot: 'melee', weapon: 'mace', title: t('Mace'), rarity: 'common', icon: 'mace', description: t('The spikes on the ball give every word more weight.'), traits: [t('Big shockwave')] },
  { id: 'spear', slot: 'melee', weapon: 'spear', title: t('Spear'), rarity: 'common', icon: 'spear', description: t('Keeps enemies at a respectful distance.'), traits: [t('Long lunges')] },
  { id: 'claymore', slot: 'melee', weapon: 'claymore', title: t('Claymore'), rarity: 'rare', icon: 'claymore', description: t('A two-handed sword forged for those who never retreat.'), traits: [t('Wide strikes'), t('Strong knockback')] },
  { id: 'dagger', slot: 'melee', weapon: 'dagger', title: t('Shadow dagger'), rarity: 'rare', icon: 'dagger', description: t('Fast as a thought and quiet as a shadow.'), traits: [t('Fast strikes'), t('Frequent crits')] },
  { id: 'hammer', slot: 'melee', weapon: 'hammer', title: t('Great hammer'), rarity: 'rare', icon: 'hammer', description: t('Every blow echoes through the stone.'), traits: [t('Huge shockwave')] },
  { id: 'scythe', slot: 'melee', weapon: 'scythe', title: t('Reaper scythe'), rarity: 'unique', icon: 'scythe', description: t('They say the scythe chooses whom to reap.'), traits: [t('Very wide sweeps'), t('Spinning whirl')] },
  { id: 'katana', slot: 'melee', weapon: 'katana', title: t('Katana'), rarity: 'rare', icon: 'katana', description: t('A thin curved blade: it cuts before the enemy realises the fight has begun.'), traits: [t('Quick long cuts'), t('Frequent crits')] },
  { id: 'nagakiba', slot: 'melee', weapon: 'nagakiba', title: t('Nagakiba'), rarity: 'unique', icon: 'nagakiba', description: t('A katana as long as a laundry pole. Awkward to carry, but enemies run out before they get close.'), traits: [t('Outreaches the spear'), t('Two-handed')] },
  { id: 'dragonslayer', slot: 'melee', weapon: 'dragonslayer', title: t('Dragonslayer'), rarity: 'unique', icon: 'dragonslayer', description: t('Too big, too thick, too heavy and too rough. A proper heap of iron.'), traits: [t('Strongest strike'), t('Very slow')] },
  { id: 'pontiff', slot: 'melee', weapon: 'pontiff', title: t('Pontiff blades'), rarity: 'unique', icon: 'pontiff', description: t('Flame in the right hand, starlight in the left. Pontiff Malivin did not like to wait.'), traits: [t('Dual weapon'), t('Fire and light in turn')] },
  { id: 'staff', slot: 'melee', weapon: 'staff', title: t('Stargazer staff'), rarity: 'rare', icon: 'staff', description: t('The crystal on its head remembers every star its owner has gazed at.'), traits: [t('Long-reach strikes'), t('Big wave')] },
  { id: 'halberd', slot: 'melee', weapon: 'halberd', title: t('Guard halberd'), rarity: 'rare', icon: 'halberd', description: t('The guards of Malina hold the gates with exactly these.'), traits: [t('Long shaft'), t('Wide arc')] },
  { id: 'rapier', slot: 'melee', weapon: 'rapier', title: t('Duellist rapier'), rarity: 'common', icon: 'rapier', description: t('A thrust, another thrust — and a polite bow.'), traits: [t('Lightning thrusts'), t('Frequent crits')] },
  { id: 'knuckles', slot: 'melee', weapon: 'knuckles', title: t('Blacksmith knuckles'), rarity: 'common', icon: 'knuckles', description: t('The blacksmith forged them for himself — in case the hammer is out of reach.'), traits: [t('Dual weapon'), t('Fastest strikes')] },
  // ranged
  { id: 'bow', slot: 'ranged', title: t('Bow'), rarity: 'common', icon: 'bow', description: t('A simple bow of supple yew.'), ranged: { dmg: 8, cd: 0.55, speed: 26, range: 20, knock: 0.3, look: { kind: 'bow', wood: '#8a5a32', string: '#e8e2d0' } } },
  { id: 'longbow', slot: 'ranged', title: t('Longbow'), rarity: 'rare', icon: 'longbow', description: t('Arrows fly farther and hit harder, but the string takes longer to draw.'), ranged: { dmg: 14, cd: 0.85, speed: 34, range: 28, knock: 0.5, look: { kind: 'bow', wood: '#4f7a3a', string: '#e8e2d0', size: 1.25 } } },
  { id: 'crossbow', slot: 'ranged', title: t('Crossbow'), rarity: 'common', icon: 'crossbow', description: t('A heavy bolt knocks enemies off their feet.'), ranged: { dmg: 12, cd: 0.95, speed: 30, range: 22, knock: 1.2, look: { kind: 'crossbow', wood: '#6a4024', string: '#d8d2c0' } } },
  { id: 'twinbow', slot: 'ranged', title: t('Star bow'), rarity: 'unique', icon: 'starbow', description: t('Every shot is a fan of three glowing arrows.'), ranged: { dmg: 7, cd: 0.6, speed: 30, range: 22, shots: 3, knock: 0.3, look: { kind: 'bow', wood: '#2f8fd0', string: '#ffffff', glow: '#5ad8ff' } } },
  // armour
  { id: 'tunic', slot: 'armor', title: t('Wanderer jacket'), rarity: 'common', icon: 'tunic', description: t('Warm, comfortable, with a pocket for raspberries.'), armor: { health: 20, perks: [{ kind: 'potion', value: 25 }], look: { body: '#5e8f46', trim: '#7a5230' } } },
  { id: 'soulrobe', slot: 'armor', title: t('Soul robe'), rarity: 'common', icon: 'soulrobe', description: t('In a certain light the souls woven into the cloth shimmer with power.'), armor: { health: 30, perks: [{ kind: 'souls', value: 50 }, { kind: 'artifactDmg', value: 50 }], look: { body: '#4a4f8a', trim: '#6b72b8', skirt: '#454a82', head: { kind: 'hood', color: '#3d4278' }, cape: '#2e3160', glow: '#7ae0ff' } } },
  { id: 'wolf', slot: 'armor', title: t('Wolf armour'), rarity: 'common', icon: 'wolf', description: t('The pelt of an old pack leader still remembers the forest.'), armor: { health: 35, perks: [{ kind: 'potion', value: 50 }], look: { body: '#9a9ea6', trim: '#5e6269', pauldron: '#c9ccd2', head: { kind: 'wolf', color: '#9a9ea6', accent: '#c9ccd2' }, cape: '#6f747c' } } },
  { id: 'mercenary', slot: 'armor', title: t('Mercenary armour'), rarity: 'common', icon: 'mercenary', description: t('Thick riveted leather, proven in a hundred skirmishes.'), armor: { health: 40, perks: [{ kind: 'meleeDmg', value: 15 }], look: { body: '#8a5a32', trim: '#c03a3a', pauldron: '#6a4024', head: { kind: 'cap', color: '#6a4024' }, cape: '#a8302e' } } },
  { id: 'scale', slot: 'armor', title: t('Scale armour'), rarity: 'rare', icon: 'scale', description: t('A thousand plates ring with every step.'), armor: { health: 50, perks: [{ kind: 'meleeDmg', value: 20 }, { kind: 'roll', value: 25 }], look: { body: '#5f8f7a', trim: '#2f4a3e', pauldron: '#8fc0a6', skirt: '#456b5a', head: { kind: 'helmet', color: '#5f8f7a', accent: '#8fc0a6' } } } },
  { id: 'champion', slot: 'armor', title: t('Champion armour'), rarity: 'unique', icon: 'champion', description: t('The shining plate of one who stood a hundred days in the arena.'), armor: { health: 65, perks: [{ kind: 'cooldown', value: 25 }, { kind: 'arrows', value: 10 }, { kind: 'meleeDmg', value: 10 }], look: { body: '#d6dbe2', trim: '#f2b632', pauldron: '#e8ecf2', head: { kind: 'helmet', color: '#d6dbe2', accent: '#f2b632' }, cape: '#c42a3a', glow: '#ff3a5a' } } },
  // artifacts
  { id: 'firework', slot: 'artifact', title: t('Fire arrow'), rarity: 'common', icon: 'firework', description: t('A rocket flies to the cursor and bursts in a shower of sparks.'), artifact: A('firework', 9, 30, { radius: 3 }) },
  { id: 'totem', slot: 'artifact', title: t('Healing totem'), rarity: 'common', icon: 'totem', description: t('Plants a totem that heals everyone nearby.'), artifact: A('totem', 22, 6, { radius: 3.5, duration: 8 }) },
  { id: 'boots', slot: 'artifact', title: t('Boots of speed'), rarity: 'common', icon: 'boots', description: t('A short burst of speed.'), artifact: A('boots', 4, 1.6, { duration: 2 }) },
  { id: 'horn', slot: 'artifact', title: t('Wind horn'), rarity: 'rare', icon: 'horn', description: t('A gust of wind knocks back everyone around.'), artifact: A('horn', 8, 6, { radius: 5 }) },
  { id: 'lightning', slot: 'artifact', title: t('Lightning cube'), rarity: 'rare', icon: 'lightning', description: t('Lightning strikes the three nearest enemies.'), artifact: A('lightning', 12, 28, { radius: 9 }) },
  // spells — src/spells.ts
  { id: 'spark', slot: 'artifact', spell: 'starter', title: t('Spark'), rarity: 'common', icon: 'spark', description: t('Lightning from the sky strikes the target and jumps to its neighbours. Hold the key — more jumps.'), artifact: A('spark', 4, 18, { radius: 12, charge: 0.9 }) },
  { id: 'fireball', slot: 'artifact', spell: 'starter', title: t('Fireball'), rarity: 'common', icon: 'fireball', description: t('A ball of flame flies to the cursor and explodes. Hold the key — the ball grows.'), artifact: A('fireball', 6, 26, { radius: 2.2, charge: 1.1 }) },
  { id: 'icerain', slot: 'artifact', spell: 'starter', title: t('Ice rain'), rarity: 'common', icon: 'icerain', description: t('Icicles fall from the sky onto the spot at the cursor. Hold the key — wider area.'), artifact: A('icerain', 10, 7, { radius: 3, duration: 2, charge: 1 }) },
  { id: 'heal', slot: 'artifact', spell: 'starter', title: t('Minor healing'), rarity: 'common', icon: 'heal', description: t('Raspberry leaves and petals close wounds. Hold the key — heals more.'), artifact: A('heal', 12, 22, { radius: 4, charge: 0.8 }) },
  // auras — src/auras.ts; like spells, boss drops only
  { id: 'pact', slot: 'aura', spell: 'boss', title: t('Blood Pact'), rarity: 'unique', icon: 'a-pact', description: t('Every strike returns part of the stolen life to the hero: red threads stretch from the enemy\'s wounds.'), aura: { kind: 'pact', value: 8, radius: 8 } },
  { id: 'bastion', slot: 'aura', spell: 'boss', title: t('Bastion'), rarity: 'unique', icon: 'a-bastion', description: t('Rune shields circle around and take part of the blows upon themselves.'), aura: { kind: 'bastion', value: 20, radius: 8 } },
  { id: 'rage', slot: 'aura', spell: 'boss', title: t('Rage'), rarity: 'unique', icon: 'a-rage', description: t('The weapon smoulders, strikes hit harder and are crushing more often.'), aura: { kind: 'rage', value: 15, radius: 8 } },
  { id: 'clarity', slot: 'aura', spell: 'boss', title: t('Clarity'), rarity: 'unique', icon: 'a-clarity', description: t('Blue lights quicken the mind: spells and artifacts recharge faster, souls cling to the hands.'), aura: { kind: 'clarity', value: 25, radius: 8 } },
  { id: 'thorns', slot: 'aura', spell: 'boss', title: t('Crown of Thorns'), rarity: 'unique', icon: 'a-thorns', description: t('Thorny vines underfoot lash everyone who strikes the hero up close.'), aura: { kind: 'thorns', value: 30, radius: 8 } },
  // offensive auras — src/aura-offense.ts
  { id: 'inferno', slot: 'aura', spell: 'boss', title: t('Furnace'), rarity: 'unique', icon: 'a-inferno', description: t('A ring of embers smoulders around the hero and burns anyone who comes near.'), aura: { kind: 'inferno', value: 3, radius: 8 } },
  { id: 'frost', slot: 'aura', spell: 'boss', title: t('Deep Frost'), rarity: 'unique', icon: 'a-frost', description: t('Rime spreads over the ground: enemies nearby freeze and bog down in the cold.'), aura: { kind: 'frost', value: 2, radius: 8 } },
  { id: 'storm', slot: 'aura', spell: 'boss', title: t('Storm Crown'), rarity: 'unique', icon: 'a-storm', description: t('Sparks run over the armour, and lightning finds an enemy on its own and jumps onward.'), aura: { kind: 'storm', value: 8, radius: 8 } },
  { id: 'halo', slot: 'aura', spell: 'boss', title: t('Punishing Halo'), rarity: 'unique', icon: 'a-halo', description: t('A golden halo above the head: every fourth strike calls a beam from the sky.'), aura: { kind: 'halo', value: 12, radius: 8 } },
  { id: 'shade', slot: 'aura', spell: 'boss', title: t('Hungry Shade'), rarity: 'unique', icon: 'a-shade', description: t('The shadow at the feet weakens enemies nearby, and in the flare it drains their life.'), aura: { kind: 'shade', value: 15, radius: 8 } },
  { id: 'quake', slot: 'aura', spell: 'boss', title: t('Stone Tread'), rarity: 'unique', icon: 'a-quake', description: t('The ground under the hero shudders and every few seconds knocks enemies back.'), aura: { kind: 'quake', value: 10, radius: 8 } },
  { id: 'blades', slot: 'aura', spell: 'boss', title: t('Whirl of Blades'), rarity: 'unique', icon: 'a-blades', description: t('Ghostly swords circle around the hero and cut everyone they touch.'), aura: { kind: 'blades', value: 4, radius: 8 } },
  // spells — src/magic/; rarity: common → common (the merchant sells it), rare → rare, legendary and mythic → unique (boss drops)
  { id: 'meteor', slot: 'artifact', spell: 'boss', title: t('Sky Hammer'), rarity: 'rare', icon: 'meteor', description: t('A blazing rock falls from the sky: a crater, a stun and burning ground.'), artifact: A('meteor', 14, 70, { radius: 3.5, charge: 1.2, info: t('Meteor: {v} damage within {r} m') }) },
  { id: 'flameserpent', slot: 'artifact', spell: 'boss', title: t('Flame Serpent'), rarity: 'unique', icon: 'flameserpent', description: t('A fiery serpent crawls along the ground, weaves between enemies and leaves a burning trail.'), artifact: A('flameserpent', 18, 22, { radius: 1.6, duration: 3.5, charge: 1.2, info: t('Serpent: {v} damage per touch, {d} s') }) },
  { id: 'ashcrown', slot: 'artifact', spell: 'shop', title: t('Ash Crown'), rarity: 'common', icon: 'ashcrown', description: t('A ring of fire spreads out from the hero as a wave and knocks everyone back.'), artifact: A('ashcrown', 8, 24, { radius: 5, charge: 0.8, info: t('Fire wave: {v} damage up to {r} m') }) },
  { id: 'icetomb', slot: 'artifact', spell: 'boss', title: t('Ice Tomb'), rarity: 'rare', icon: 'icetomb', description: t('The enemy freezes into a crystal, and a moment later the crystal bursts in a fan of shards.'), artifact: A('icetomb', 14, 60, { radius: 3.5, duration: 2, charge: 1, info: t('Tomb: {v} damage, shards up to {r} m') }) },
  { id: 'frostridge', slot: 'artifact', spell: 'shop', title: t('Frost Ridge'), rarity: 'common', icon: 'frostridge', description: t('A fan of ice spikes grows out of the ground and tosses enemies up.'), artifact: A('frostridge', 7, 26, { radius: 7, charge: 0.9, info: t('Spikes: {v} damage, fan of {r} m') }) },
  { id: 'absolutezero', slot: 'artifact', spell: 'boss', title: t('Absolute Zero'), rarity: 'unique', icon: 'absolutezero', description: t('A dome of frost: inside, time nearly stands still, enemies ice over and freeze in place.'), artifact: A('absolutezero', 30, 40, { radius: 8, duration: 4, charge: 1.6, info: t('Dome: {v} damage in waves, {d} s within {r} m') }) },
  { id: 'thunderspear', slot: 'artifact', spell: 'boss', title: t('Thunderer Spear'), rarity: 'rare', icon: 'thunderspear', description: t('A spear of lightning grows in the hand and pierces the whole line.'), artifact: A('thunderspear', 9, 55, { radius: 18, charge: 1.2, info: t('Spear: {v} damage along a {r} m line') }) },
  { id: 'thunderleap', slot: 'artifact', spell: 'boss', title: t('Thunder Leap'), rarity: 'unique', icon: 'thunderleap', description: t('The hero leaps up and slams the ground: chain lightning in every direction.'), artifact: A('thunderleap', 14, 45, { radius: 4.5, charge: 1, info: t('Slam: {v} damage within {r} m plus lightning') }) },
  { id: 'stormcloud', slot: 'artifact', spell: 'shop', title: t('Storm Cloud'), rarity: 'common', icon: 'stormcloud', description: t('A cloud hangs over the hero and strikes the nearest enemies on its own.'), artifact: A('stormcloud', 16, 16, { radius: 7, duration: 8, charge: 0.8, info: t('Cloud: {v} damage per bolt, {d} s') }) },
  { id: 'starfall', slot: 'artifact', spell: 'boss', title: t('Starfall'), rarity: 'unique', icon: 'starfall', description: t('Stars fall from the sky across the whole area while the hero hovers in a pillar of light.'), artifact: A('starfall', 22, 18, { radius: 6, duration: 5, charge: 1.2, info: t('Stars: {v} damage each, {d} s within {r} m') }) },
  { id: 'starbeam', slot: 'artifact', spell: 'boss', title: t('Fallen Star Beam'), rarity: 'unique', icon: 'starbeam', description: t('A huge beam from the hands: the hero slowly sweeps it after the cursor.'), artifact: A('starbeam', 30, 30, { radius: 16, duration: 3, charge: 1.6, info: t('Beam: {v} damage per touch, {d} s, length {r} m') }) },
  { id: 'judgement', slot: 'artifact', spell: 'boss', title: t('Heavenly Judgement'), rarity: 'unique', icon: 'judgement', description: t('A pillar of light strikes enemies, heals allies and raises the fallen.'), artifact: A('judgement', 24, 60, { radius: 4, charge: 1.3, info: t('Judgement: {v} damage and healing within {r} m') }) },
  { id: 'deadchoir', slot: 'artifact', spell: 'boss', title: t('Choir of the Dead'), rarity: 'rare', icon: 'deadchoir', description: t('Ghostly hands reach out of the ground, hold enemies and drag them down.'), artifact: A('deadchoir', 14, 14, { radius: 4, duration: 3, charge: 1, info: t('Hands: {v} damage in waves, {d} s within {r} m') }) },
  { id: 'gravitywell', slot: 'artifact', spell: 'boss', title: t('Gravity Well'), rarity: 'unique', icon: 'gravitywell', description: t('A black sphere pulls enemies in, then collapses and flings them out.'), artifact: A('gravitywell', 20, 70, { radius: 6, duration: 2, charge: 1.2, info: t('Well: pulls for {d} s, burst of {v} damage') }) },
  { id: 'skullscythe', slot: 'artifact', spell: 'shop', title: t('Skull Scythe'), rarity: 'common', icon: 'skullscythe', description: t('A flying skull: damage to the enemy, a little life to the hero.'), artifact: A('skullscythe', 5, 30, { radius: 14, charge: 0.7, info: t('Skull: {v} damage, range {r} m') }) },
  { id: 'fallenguards', slot: 'artifact', spell: 'boss', title: t('Fallen Guards'), rarity: 'rare', icon: 'fallenguards', description: t('Three ghostly knights step out of portals and fight alongside.'), artifact: A('fallenguards', 30, 12, { duration: 15, souls: 50, charge: 1.2, info: t('Guards: {v} damage per strike, {d} s') }) },
  { id: 'rift', slot: 'artifact', spell: 'boss', title: t('Rift'), rarity: 'rare', icon: 'rift', description: t('A crack runs forward and stone spikes grow out of it.'), artifact: A('rift', 10, 40, { radius: 10, charge: 1, info: t('Rift: {v} damage along a {r} m line') }) },
  // base spells — src/magic/base-*.ts; not too strong, all sold by the merchant
  { id: 'firewall', slot: 'artifact', spell: 'shop', title: t('Fire Wall'), rarity: 'common', icon: 'firewall', description: t('A wall of fire rises across the path to the cursor and burns everyone in it or passing through. Hold the key — longer and hotter.'), artifact: A('firewall', 10, 8, { radius: 5, duration: 4, charge: 1, info: t('Wall of {r} m: {v} damage every 0.5 s, {d} s') }) },
  { id: 'firestorm', slot: 'artifact', spell: 'shop', title: t('Fire Hurricane'), rarity: 'common', icon: 'firestorm', description: t('A fiery twister rolls slowly to the cursor, pulling in and slowing enemies.'), artifact: A('firestorm', 12, 6, { radius: 1.8, duration: 4, charge: 1, info: t('Twister: {v} damage every 0.3 s, −30 % speed, {d} s') }) },
  { id: 'armageddon', slot: 'artifact', spell: 'shop', title: t('Minor Armageddon'), rarity: 'common', icon: 'armageddon', description: t('For three seconds fireballs rain down around the hero.'), artifact: A('armageddon', 16, 14, { radius: 5, duration: 3, charge: 1.1, info: t('Rain of fireballs: {v} damage each, {r} m circle, {d} s') }) },
  { id: 'wolves', slot: 'artifact', spell: 'shop', title: t('Wolf Pack'), rarity: 'common', icon: 'wolves', description: t('Wolves run out of portals and chase the nearest enemies; a bite slows. Hold the key — three wolves.'), artifact: A('wolves', 20, 8, { duration: 12, charge: 1, info: t('Wolves: {v} damage per bite, {d} s') }) },
  { id: 'elemental', slot: 'artifact', spell: 'shop', title: t('Minor Elemental'), rarity: 'common', icon: 'elemental', description: t('An elemental hovers nearby and shoots wisps; the element cycles — fire, ice, lightning.'), artifact: A('elemental', 22, 10, { radius: 6, duration: 15, charge: 1, info: t('Elemental: {v} damage per wisp, {d} s') }) },
  { id: 'golem', slot: 'artifact', spell: 'shop', title: t('Stone Golem'), rarity: 'common', icon: 'golem', description: t('A slow stone golem pounds the ground with its fist and keeps enemies on itself.'), artifact: A('golem', 28, 18, { radius: 2, duration: 18, charge: 1.1, info: t('Golem: {v} damage in a {r} m circle, stun, {d} s') }) },
  { id: 'bloodclaws', slot: 'artifact', spell: 'shop', title: t('Raspberry Claws'), rarity: 'common', icon: 'bloodclaws', description: t('Three claws of raspberry flame burst out of the ground in front of the hero. Costs health, builds up bleeding.'), artifact: A('bloodclaws', 5, 22, { radius: 3, charge: 0.8, info: t('Claws: {v} damage, bleeding; costs 6 % health') }) },
  { id: 'bloodswarm', slot: 'artifact', spell: 'shop', title: t('Berry Swarm'), rarity: 'common', icon: 'bloodswarm', description: t('A cone-shaped stream of tiny raspberry midges stings and builds up bleeding. Costs health.'), artifact: A('bloodswarm', 6, 4, { radius: 5, duration: 1.5, charge: 0.8, info: t('Swarm: {v} damage per sting, {d} s; costs 8 % health') }) },
  { id: 'bloodblade', slot: 'artifact', spell: 'shop', title: t('Raspberry Blade'), rarity: 'common', icon: 'bloodblade', description: t('The weapon is coated in raspberry juice: strikes hit harder and build up bleeding. Costs health.'), artifact: A('bloodblade', 25, 10, { duration: 15, charge: 1, info: t('Blade: +{v}% sword damage and bleeding, {d} s; costs 10 % health') }) },
  { id: 'blindflash', slot: 'artifact', spell: 'shop', title: t('Blinding Flash'), rarity: 'common', icon: 'blindflash', description: t('A flash of light around the hero: damage, knockback and a stun for regular enemies (not bosses).'), artifact: A('blindflash', 14, 12, { radius: 4, duration: 1.5, charge: 0.9, info: t('Flash: {v} damage within {r} m, stun {d} s') }) },
  { id: 'raspberrybush', slot: 'artifact', spell: 'shop', title: t('Raspberry Bush'), rarity: 'common', icon: 'raspberrybush', description: t('A thorny bush holds enemies, then bursts into berries that heal.'), artifact: A('raspberrybush', 12, 20, { radius: 3, duration: 4, charge: 0.9, info: t('Bush: {v} damage from thorns, heals with berries') }) },
  { id: 'titanform', slot: 'artifact', spell: 'boss', title: t('Titan Form'), rarity: 'unique', icon: 'titanform', description: t('The hero becomes a huge stone giant: strikes shake the earth.'), artifact: A('titanform', 40, 60, { duration: 10, charge: 1.5, info: t('Titan: +{v}% damage, −50% damage taken, {d} s') }) },
  { id: 'bladephalanx', slot: 'artifact', spell: 'boss', title: t('Blade Phalanx'), rarity: 'rare', icon: 'bladephalanx', description: t('Seven ghostly swords fan out above the head and fly one after another.'), artifact: A('bladephalanx', 10, 20, { radius: 14, charge: 1, info: t('Blades: 7 × {v} damage') }) },
  { id: 'blink', slot: 'artifact', spell: 'boss', title: t('Tear'), rarity: 'rare', icon: 'blink', description: t('A dash through space: an explosion where you vanished and where you appeared.'), artifact: A('blink', 8, 45, { radius: 8, charge: 0.8, info: t('Tear: {v} damage twice, dash up to {r} m') }) },
  { id: 'harvester', slot: 'artifact', title: t('Soul Reaper'), rarity: 'unique', icon: 'harvester', description: t('Releases the gathered souls in a burst around the hero.'), artifact: A('harvester', 3, 45, { radius: 4, souls: 40 }) },
  // relics — drop from enemies only (src/sim/drops.ts). Weapons: models and strikes — RELIC_WEAPONS in src/weapons.ts, the hit effect — src/gear.ts
  { id: 'emberfang', slot: 'melee', weapon: 'emberfang', mob: true, relic: 'burn', title: t('Emberfang'), rarity: 'unique', icon: 'katana', description: t('A katana quenched in a volcano\'s throat. The blade never cooled.'), traits: [t('Quick long cuts'), t('Drops only from enemies')] },
  { id: 'frostbite', slot: 'melee', weapon: 'frostbite', mob: true, relic: 'chill', title: t('Winter\'s Bite'), rarity: 'unique', icon: 'claymore', description: t('A two-hander of never-melting ice. Whoever it touches forgets how to hurry.'), traits: [t('Wide strikes'), t('Drops only from enemies')] },
  { id: 'stormcaller', slot: 'melee', weapon: 'stormcaller', mob: true, relic: 'chain', title: t('Stormcaller'), rarity: 'unique', icon: 'spear', description: t('A spear that was struck by lightning seven times and liked it.'), traits: [t('Long lunges'), t('Drops only from enemies')] },
  { id: 'bloodthorn', slot: 'melee', weapon: 'bloodthorn', mob: true, relic: 'leech', title: t('Bloodthorn'), rarity: 'unique', icon: 'rapier', description: t('A raspberry thorn the length of an arm. It drinks, and shares with its owner.'), traits: [t('Lightning thrusts'), t('Drops only from enemies')] },
  { id: 'starcleaver', slot: 'melee', weapon: 'starcleaver', mob: true, relic: 'nova', title: t('Starcleaver'), rarity: 'unique', icon: 'dragonslayer', description: t('A slab of fallen star with a handle. Heavy as the night sky.'), traits: [t('Strongest strike'), t('Drops only from enemies')] },
  { id: 'voidedge', slot: 'melee', weapon: 'voidedge', mob: true, relic: 'expose', title: t('Edge of the Void'), rarity: 'unique', icon: 'dagger', description: t('A dagger with nothing where the blade should be. The nothing cuts.'), traits: [t('Fast strikes'), t('Drops only from enemies')] },
  { id: 'thunderfists', slot: 'melee', weapon: 'thunderfists', mob: true, relic: 'stun', title: t('Thunder Fists'), rarity: 'unique', icon: 'knuckles', description: t('Each knuckle holds a small thunderstorm. They argue.'), traits: [t('Fastest strikes'), t('Drops only from enemies')] },
  { id: 'midnightscythe', slot: 'melee', weapon: 'midnightscythe', mob: true, relic: 'souls', title: t('Midnight Scythe'), rarity: 'unique', icon: 'scythe', description: t('It reaps at midnight, and every soul it frees stays close.'), traits: [t('Very wide sweeps'), t('Drops only from enemies')] },
  { id: 'sunlance', slot: 'melee', weapon: 'sunlance', mob: true, relic: 'smite', title: t('Sun Halberd'), rarity: 'unique', icon: 'halberd', description: t('The halberd of the first gate guard. The sun still stands watch with it.'), traits: [t('Long shaft'), t('Drops only from enemies')] },
  { id: 'berryking', slot: 'melee', weapon: 'berryking', mob: true, relic: 'quake', title: t('Raspberry King\'s Hammer'), rarity: 'unique', icon: 'hammer', description: t('The King of Raspberries used it to crack nuts. And castles.'), traits: [t('Huge shockwave'), t('Drops only from enemies')] },
  // relic spells — src/magic/relics.ts
  { id: 'dragonbreath', slot: 'artifact', spell: 'mob', mob: true, title: t('Dragon Breath'), rarity: 'unique', icon: 'flameserpent', description: t('A roaring cone of dragon fire burns everything in front of the hero. Drops only from enemies.'), artifact: A('dragonbreath', 14, 34, { radius: 10, duration: 1.6, charge: 1, info: t('Fire cone: {v} damage ×8, {r} m') }) },
  { id: 'glacier', slot: 'artifact', spell: 'mob', mob: true, title: t('Glacier'), rarity: 'unique', icon: 'absolutezero', description: t('A glacier bursts out of the ground at the cursor: huge damage, and everyone inside freezes. Drops only from enemies.'), artifact: A('glacier', 18, 130, { radius: 5.5, duration: 2.5, charge: 1.2, info: t('Glacier: {v} damage within {r} m, frozen for {d} s') }) },
  { id: 'worldstorm', slot: 'artifact', spell: 'mob', mob: true, title: t('Wrath of the Storm'), rarity: 'unique', icon: 'spark', description: t('The sky splits: lightning hammers every enemy around, again and again. Drops only from enemies.'), artifact: A('worldstorm', 20, 46, { radius: 11, duration: 2.4, charge: 1.2, info: t('Storm: 14 bolts of {v} damage within {r} m') }) },
  { id: 'supernova', slot: 'artifact', spell: 'mob', mob: true, title: t('Supernova'), rarity: 'unique', icon: 'starfall', description: t('A star is born at the cursor, swells — and explodes. Drops only from enemies.'), artifact: A('supernova', 26, 260, { radius: 7.5, charge: 1.5, info: t('Explosion: {v} damage within {r} m') }) },
  { id: 'soulstorm', slot: 'artifact', spell: 'mob', mob: true, title: t('Storm of Souls'), rarity: 'unique', icon: 'skullscythe', description: t('Sixteen homing souls burst from the hero and find the enemies themselves. Drops only from enemies.'), artifact: A('soulstorm', 12, 40, { radius: 16, charge: 1, info: t('Souls: 16 × {v} damage, they seek targets up to {r} m') }) },
  { id: 'earthshatter', slot: 'artifact', spell: 'mob', mob: true, title: t('Earthshatter'), rarity: 'unique', icon: 'rift', description: t('Three waves of broken ground roll out from the hero, each wider than the last. Drops only from enemies.'), artifact: A('earthshatter', 16, 80, { radius: 10, charge: 1.1, info: t('Three waves: {v} damage each, up to {r} m') }) },
  { id: 'bloodmoon', slot: 'artifact', spell: 'mob', mob: true, title: t('Raspberry Moon'), rarity: 'unique', icon: 'bloodblade', description: t('A crimson moon rises over the cursor: its light burns enemies and heals the hero. Drops only from enemies.'), artifact: A('bloodmoon', 24, 22, { radius: 6.5, duration: 6, charge: 1.2, info: t('Moon: {v} damage every 0.5 s within {r} m, {d} s; heals') }) },
  { id: 'timestop', slot: 'artifact', spell: 'mob', mob: true, title: t('Stopped Hour'), rarity: 'unique', icon: 'gravitywell', description: t('Time stands still for every enemy around; while it does, they take half as much damage again. Drops only from enemies.'), artifact: A('timestop', 30, 30, { radius: 10, duration: 4, charge: 1, info: t('Stops enemies within {r} m for {d} s, +50 % damage to them') }) },
  { id: 'phoenix', slot: 'artifact', spell: 'mob', mob: true, title: t('Phoenix'), rarity: 'unique', icon: 'fireball', description: t('A firebird flies through the ranks to the cursor and explodes; its warmth heals the hero. Drops only from enemies.'), artifact: A('phoenix', 18, 110, { radius: 18, charge: 1.1, info: t('Phoenix: {v} damage along {r} m and a blast; heals') }) },
  { id: 'bladestorm', slot: 'artifact', spell: 'mob', mob: true, title: t('Thousand Cuts'), rarity: 'unique', icon: 'bladephalanx', description: t('For four seconds the air around the hero is nothing but blades. Drops only from enemies.'), artifact: A('bladestorm', 16, 24, { radius: 5, duration: 4, charge: 1, info: t('Cuts: {v} damage every 0.2 s within {r} m, {d} s') }) },
];

/** Starter spells (wiki/design-spells.md, section 2) */
export const STARTER_SPELLS = ['fireball', 'spark', 'heal', 'icerain'] as const;
export const AURAS = ['pact', 'bastion', 'rage', 'clarity', 'thorns', 'inferno', 'frost', 'storm', 'halo', 'shade', 'quake', 'blades'] as const;
/** Spells the merchant sells (common) */
export const SHOP_SPELLS = (): string[] => ITEMS.filter((d) => d.spell === 'shop').map((d) => d.id);
/** Boss spells — while there are no bosses, they are in the inventory from the start */
const BOSS_SPELL_IDS = (): string[] => ITEMS.filter((d) => d.spell === 'boss' && d.slot === 'artifact').map((d) => d.id);
/** Base spells (src/magic/base-*.ts): the merchant sells them, and in the playground the hero has them from the start */
export const BASE_SPELLS = ['firewall', 'firestorm', 'armageddon', 'wolves', 'elemental', 'golem', 'bloodclaws', 'bloodswarm', 'bloodblade', 'blindflash'];

/** Relics: the twenty items that drop from enemies only */
export const MOB_DROPS = (): ItemDef[] => ITEMS.filter((d) => d.mob);
/** Of the items enemies leave, this share are relics; the rest is ordinary gear */
export const RELIC_SHARE = 0.3;
/** What a fallen enemy leaves (src/sim/drops.ts): a relic (always — from a mini-boss) or gear from the common pool, uniques rarely */
export function rollMobLoot(r: Rand, relic = false): { def: string; relic: boolean } {
  if (relic || r() < RELIC_SHARE) { const p = MOB_DROPS(); return { def: p[Math.floor(r() * p.length)].id, relic: true }; }
  const x = r(), rarity: Rarity = x < 0.1 ? 'unique' : x < 0.4 ? 'rare' : 'common';
  const pool = ITEMS.filter((d) => d.rarity === rarity && !d.spell && !d.mob);
  return { def: pool[Math.floor(r() * pool.length)].id, relic: false };
}
/** Power of an item an enemy left for a hero of power `power`: a relic is one above */
export const mobLootPower = (def: string, power: number): number => Math.max(1, power + (itemDef(def).mob ? 1 : 0));

export const itemDef = (id: string): ItemDef => {
  const d = ITEMS.find((x) => x.id === id);
  if (!d) throw new Error(`No item ${id}`);
  return d;
};

// ---------- enchantments ----------

export type EnchantId =
  | 'sharpness' | 'critical' | 'leeching' | 'knockback' | 'swirling' | 'fireAspect' | 'soulSiphon' | 'smiting'
  | 'power' | 'multishot' | 'infinity' | 'accelerate' | 'punch' | 'piercing'
  | 'health' | 'cooldown' | 'soulGather' | 'potionBoost' | 'acrobat' | 'regen';

export interface EnchantDef {
  id: EnchantId;
  title: string;
  slot: Exclude<ItemSlot, 'artifact' | 'aura'>;
  /** Powerful: 1 point more per tier, rolls only on uniques */
  powerful?: boolean;
  /** Value at tiers I, II, III */
  tiers: [number, number, number];
  /** Icon and diamond colour */
  icon: string;
  color: string;
  text: (v: number) => string;
}

export const ENCHANTS: readonly EnchantDef[] = [
  { id: 'sharpness', slot: 'melee', title: t('Sharpness'), tiers: [10, 20, 30], icon: 'e-blade', color: '#5ab8ff', text: (v) => t('+{v}% melee damage', { v }) },
  { id: 'critical', slot: 'melee', title: t('Critical Hit'), tiers: [10, 15, 20], icon: 'e-star', color: '#ffcf3a', text: (v) => t('{v}% chance to deal triple damage', { v }) },
  { id: 'leeching', slot: 'melee', title: t('Leeching'), tiers: [4, 8, 12], icon: 'e-drop', color: '#e2304a', text: (v) => t('A strike heals for {v}% of the damage', { v }) },
  { id: 'knockback', slot: 'melee', title: t('Knockback'), tiers: [30, 60, 90], icon: 'e-fist', color: '#c08a5a', text: (v) => t('+{v}% knockback', { v }) },
  { id: 'swirling', slot: 'melee', title: t('Swirling'), tiers: [15, 30, 45], icon: 'e-swirl', color: '#7ae0d0', text: (v) => t('Finisher shockwave is {v}% wider', { v }) },
  { id: 'fireAspect', slot: 'melee', title: t('Fire Aspect'), tiers: [3, 6, 9], icon: 'e-flame', color: '#ff7a2a', text: (v) => t('Sets the target on fire: +{v} fire damage', { v }) },
  { id: 'soulSiphon', slot: 'melee', title: t('Soul Siphon'), tiers: [1, 2, 3], icon: 'soul', color: '#5ae0ff', text: (v) => t('+{v} souls per strike', { v }) },
  { id: 'smiting', slot: 'melee', title: t('Smiting'), powerful: true, tiers: [15, 30, 45], icon: 'e-bolt', color: '#c27aff', text: (v) => t('{v}% chance that any strike makes a shockwave', { v }) },
  { id: 'power', slot: 'ranged', title: t('Power'), tiers: [20, 35, 50], icon: 'e-arrow', color: '#5ab8ff', text: (v) => t('+{v}% arrow damage', { v }) },
  { id: 'multishot', slot: 'ranged', title: t('Multishot'), tiers: [20, 35, 50], icon: 'e-multi', color: '#5ad86a', text: (v) => t('{v}% chance to fire 2 extra arrows', { v }) },
  { id: 'infinity', slot: 'ranged', title: t('Infinity'), tiers: [25, 50, 75], icon: 'e-inf', color: '#a77aff', text: (v) => t('{v}% chance not to spend an arrow', { v }) },
  { id: 'accelerate', slot: 'ranged', title: t('Accelerate'), tiers: [10, 20, 30], icon: 'e-clock', color: '#ffcf3a', text: (v) => t('Shoots {v}% faster', { v }) },
  { id: 'punch', slot: 'ranged', title: t('Punch'), tiers: [50, 100, 150], icon: 'e-fist', color: '#c08a5a', text: (v) => t('+{v}% arrow knockback', { v }) },
  { id: 'piercing', slot: 'ranged', title: t('Piercing'), powerful: true, tiers: [1, 2, 3], icon: 'e-pierce', color: '#c27aff', text: (v) => (v === 1 ? t('An arrow pierces 1 target') : t('An arrow pierces {v} targets', { v })) },
  { id: 'health', slot: 'armor', title: t('Fortitude'), tiers: [10, 20, 30], icon: 'heart', color: '#e2304a', text: (v) => t('+{v} health', { v }) },
  { id: 'cooldown', slot: 'armor', title: t('Cooldown'), tiers: [10, 18, 25], icon: 'e-clock', color: '#ffcf3a', text: (v) => t('−{v}% artifact cooldown', { v }) },
  { id: 'soulGather', slot: 'armor', title: t('Soul Gatherer'), tiers: [25, 50, 75], icon: 'soul', color: '#5ae0ff', text: (v) => t('+{v}% souls gathered', { v }) },
  { id: 'potionBoost', slot: 'armor', title: t('Healer'), tiers: [20, 40, 60], icon: 'potion', color: '#ff5a7a', text: (v) => t('The potion heals {v}% more', { v }) },
  { id: 'acrobat', slot: 'armor', title: t('Acrobat'), tiers: [15, 30, 45], icon: 'roll', color: '#5ab8ff', text: (v) => t('−{v}% dodge roll cooldown', { v }) },
  { id: 'regen', slot: 'armor', title: t('Regeneration'), powerful: true, tiers: [1, 2, 3], icon: 'e-leaf', color: '#5ad86a', text: (v) => t('+{v} health per second', { v }) },
];

export const enchantDef = (id: EnchantId): EnchantDef => {
  const d = ENCHANTS.find((e) => e.id === id);
  if (!d) throw new Error(`No enchantment ${id}`);
  return d;
};

/** Cost of tier (1..3): regular — tier points, powerful — tier + 1 */
export const enchantCost = (e: EnchantDef, tier: number): number => tier + (e.powerful ? 1 : 0);

// ---------- instances ----------

export interface EnchantSlot {
  /** Three options to choose from */
  options: EnchantId[];
  /** Chosen option (index in options) or −1 */
  chosen: number;
  /** Tier 0..3 */
  tier: number;
}

export interface Item {
  uid: string;
  def: string;
  power: number;
  enchants: EnchantSlot[];
  /** Not yet looked at in the inventory — yellow corner */
  isNew?: boolean;
}

export interface Equipment {
  melee: string | null;
  ranged: string | null;
  armor: string | null;
  artifacts: [string | null, string | null, string | null];
  /** Fourth slot — aura */
  aura: string | null;
}

export interface ProfileData {
  version: 1;
  level: number;
  xp: number;
  /** Free enchantment points */
  points: number;
  /** Raspberries — the currency, like emeralds in MCD */
  berries: number;
  souls: number;
  arrows: number;
  seq: number;
  items: Item[];
  equip: Equipment;
  /** Seeds brought out of expeditions (wiki/design-expeditions.md, section 8): common, rare, golden; absent — none yet */
  seeds?: { common: number; rare: number; golden: number };
  /** Parcels taken on expeditions — three slots (src/sim/parcel.ts); absent — the default set */
  parcels?: string[];
  /** Expeditions: the highest difficulty open to the hero (1 by default), camp beds by kind, progress on the order of the day (src/expedition/camp.ts) */
  expLevel?: number;
  beds?: Record<string, number>;
  order?: { day: number; n: number; done: boolean };
}

/** Multiplier from item power: +6% per unit */
export const powerMult = (power: number): number => 1 + (power - 1) * 0.06;
/** XP to the next level */
export const xpToNext = (level: number): number => 40 + (level - 1) * 20;
export const MAX_SOULS = 100;
export const MAX_ARROWS = 200;
export const ARROW_BUNDLE = 12;

const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Enchantment slots: by rarity, three different options in each; on a unique one option is powerful */
export function rollEnchantSlots(def: ItemDef, r: Rand): EnchantSlot[] {
  if (def.slot === 'artifact' || def.slot === 'aura') return [];
  const pool = ENCHANTS.filter((e) => e.slot === def.slot);
  const normal = pool.filter((e) => !e.powerful), strong = pool.filter((e) => e.powerful);
  const out: EnchantSlot[] = [];
  for (let s = 0; s < RARITY[def.rarity].slots; s++) {
    const bag = [...normal];
    const options: EnchantId[] = [];
    if (def.rarity === 'unique' && s === 0 && strong.length) options.push(strong[Math.floor(r() * strong.length)].id);
    while (options.length < 3 && bag.length) options.push(bag.splice(Math.floor(r() * bag.length), 1)[0].id);
    out.push({ options, chosen: -1, tier: 0 });
  }
  return out;
}

/** Points invested in the item */
export function spentPoints(it: Item): number {
  let n = 0;
  for (const s of it.enchants) {
    if (s.chosen < 0) continue;
    const e = enchantDef(s.options[s.chosen]);
    for (let t = 1; t <= s.tier; t++) n += enchantCost(e, t);
  }
  return n;
}

/** Shop prices (src/hud/shop.ts): reforging, arrows, a common spell; everything else — by stats (src/prices.ts) */
export const PRICE = {
  arrows: 20,
  reforge: (power: number): number => 30 + power * 15,
  /** A common spell at the merchant */
  spell: (power: number): number => 110 + power * 12,
};

/** Raspberries for salvaging */
export const salvageValue = (it: Item): number => Math.round((8 + it.power * 5) * RARITY[itemDef(it.def).rarity].salvage);

/** Enchantment value on the item (sum over slots), 0 — none */
export function enchantValue(it: Item | null | undefined, id: EnchantId): number {
  if (!it) return 0;
  let v = 0;
  for (const s of it.enchants) if (s.chosen >= 0 && s.tier > 0 && s.options[s.chosen] === id) v += enchantDef(id).tiers[s.tier - 1];
  return v;
}

/** Item numbers for the card: armour health, arrow and artifact damage with power */
export function armorHealth(it: Item): number { return Math.round((itemDef(it.def).armor?.health ?? 0) * powerMult(it.power)); }

// ---------- hero profile ----------

/**
 * Where the stored hero lives (wiki/design-multiplayer.md, section 5): the camp profile on the server (src/net/profile-store.ts),
 * dev pages — in memory. `Profile` itself does not save anywhere: `save()` only notifies, the storage listens
 */
export interface ProfileStorage {
  /** The stored profile (the camp copy), null — none */
  stored(): ProfileData | null;
  /** Change the stored profile (battle growth, victory loot) and save it */
  update(f: (d: ProfileData) => void): void;
}

let storage: ProfileStorage | null = null;
/** The page's profile storage: the game — the server one, dev pages — memory */
export function setProfileStorage(s: ProfileStorage | null): void { storage = s; }

/** Arrows into a defence battle — at least this many */
export const BATTLE_ARROWS = 40;

/** Gear summary — the scene reads it */
export interface GearStats {
  meleeMult: number;
  critChance: number;
  leech: number;
  knockMult: number;
  waveMult: number;
  fireDmg: number;
  soulsPerHit: number;
  smiteChance: number;
  rangedMult: number;
  rangedCdMult: number;
  multishot: number;
  infinity: number;
  rangedKnock: number;
  pierce: number;
  maxHpBonus: number;
  soulsMult: number;
  artifactCdMult: number;
  artifactMult: number;
  potionMult: number;
  rollCdMult: number;
  regen: number;
  speedMult: number;
  arrowBundle: number;
}

/**
 * A change of the gear in an online battle (wiki/design-multiplayer.md, section 7): the client does it on its own copy and sends
 * only this — the server repeats it on the hero's copy from the database (src/game/match.ts) and charges the sutler itself
 */
export type KitOp =
  | { op: 'equip'; uid: string; at?: number }
  /** Artifact slot 0–2; -1 — the aura */
  | { op: 'unequip'; slot: number }
  | { op: 'salvage'; uid: string }
  | { op: 'enchant'; uid: string; slot: number; option: number }
  /** A sutler item at the hero's power */
  | { op: 'buy'; def: string }
  /** A sutler arrow bundle */
  | { op: 'arrows' };

export class Profile {
  data: ProfileData;
  /** Gear changes for the battle server (src/cgame/net-battle.ts); unset — nobody listens */
  onOp?: (op: KitOp) => void;
  private readonly listeners = new Set<() => void>();
  private rand: Rand;

  /** A battle copy (`enterBattle`): saving keeps only the growth */
  private battleMode = false;

  /** The profile never writes by itself: the storage (setProfileStorage) listens to `save()` */
  constructor(data?: ProfileData) {
    this.data = data ?? Profile.starter();
    this.rand = rng(hash(String(this.data.seq)) || 1);
    this.data.equip.aura ??= null;
  }

  /**
   * A stored save brought up to date: unknown items dropped, the starter spells, auras, boss spells and new weapons added.
   * true — the save changed (write it back)
   */
  static upgrade(d: ProfileData): boolean {
    const n = d.items.length;
    d.items = d.items.filter((i) => ITEMS.some((x) => x.id === i.def));
    d.equip.aura ??= null;
    return new Profile(d).addStarterSpells() || d.items.length !== n;
  }

  /** Saves from before spells: the four starters go to the inventory, free slots are filled with them */
  private addStarterSpells(): boolean {
    const have = new Set(this.data.items.map((i) => i.def));
    const add = STARTER_SPELLS.filter((d) => !have.has(d));
    // while there are no bosses — auras and boss spells go to the inventory so they can be tried on
    // playground: all melee weapons are in the inventory, new weapons reach old saves too
    const extra = [...AURAS, ...BOSS_SPELL_IDS(), ...BASE_SPELLS, ...ITEMS.filter((d) => d.slot === 'melee' && !d.mob).map((d) => d.id)].filter((d) => !have.has(d));
    if (!add.length && !extra.length) return false;
    for (const d of add) {
      const it = this.add(d, 1);
      const free = this.data.equip.artifacts.indexOf(null);
      if (free >= 0) this.data.equip.artifacts[free] = it.uid;
    }
    for (const d of extra) this.add(d, itemDef(d).rarity === 'unique' ? 3 : itemDef(d).rarity === 'rare' ? 2 : 1);
    return true;
  }

  /** Starter kit: a beginner's equipment and a chest of loot, so there is something to try on and enchant */
  static starter(): ProfileData {
    const p = new Profile({ version: 1, level: 1, xp: 0, points: 3, berries: 250, souls: 0, arrows: 40, seq: 0, items: [], equip: { melee: null, ranged: null, armor: null, artifacts: [null, null, null], aura: null } });
    const eq = (def: string, power: number): string => p.add(def, power, false).uid;
    p.data.equip = { melee: eq('sword', 1), armor: eq('tunic', 1), ranged: eq('bow', 1), artifacts: [eq('fireball', 1), eq('spark', 1), eq('heal', 1)], aura: null };
    for (const [def, power] of [
      ['icerain', 1], ['firework', 1], ['totem', 1], ...AURAS.map((id): [string, number] => [id, 1]),
      ...BOSS_SPELL_IDS().map((id): [string, number] => [id, 1]),
      ...BASE_SPELLS.map((id): [string, number] => [id, 1]),
      ['claymore', 3], ['axe', 2], ['dagger', 2], ['hammer', 3], ['scythe', 4], ['mace', 1], ['spear', 2],
      ['katana', 3], ['nagakiba', 4], ['dragonslayer', 4], ['pontiff', 4], ['staff', 3], ['halberd', 3], ['rapier', 2], ['knuckles', 2],
      ['crossbow', 2], ['longbow', 3], ['twinbow', 4],
      ['soulrobe', 2], ['wolf', 2], ['mercenary', 1], ['scale', 3], ['champion', 4],
      ['boots', 2], ['horn', 2], ['lightning', 3], ['harvester', 3],
    ] as [string, number][]) p.add(def, power, false);
    return p.data;
  }

  /**
   * Bush Defence battle (wiki/design-tower-defence.md, section 12): the hero goes in with their own gear, but works on a copy —
   * what the sutler sells, the battle raspberries and the inventory shuffles live only in this battle. The stored profile
   * gets only the growth (experience, level, enchant points for new levels, `keepGrowth`) and the victory loot (`creditStored`).
   * A closed tab mid-battle loses nothing of the camp
   */
  enterBattle(): void {
    this.battleMode = true;
    this.data = structuredClone(this.data);
    this.data.arrows = Math.max(this.data.arrows, BATTLE_ARROWS);
    this.save();
  }

  /** "Once more" / restart: the battle copy is taken anew from the stored profile — sutler purchases are gone */
  restartBattle(): void {
    if (!this.battleMode) return;
    const s = storage?.stored();
    if (!s) return;
    const stored = structuredClone(s);
    const keep = this.data.berries;
    this.data = stored;
    this.data.equip.aura ??= null;
    this.data.berries = keep;
    this.data.arrows = Math.max(this.data.arrows, BATTLE_ARROWS);
    this.save();
  }

  /** Battle growth into the stored profile: experience and level, +1 enchant point per new level */
  static keepGrowth(d: ProfileData): void {
    const s = storage?.stored();
    if (!s || (d.level < s.level || (d.level === s.level && d.xp <= s.xp))) return;
    storage?.update((x) => {
      x.points += Math.max(0, d.level - x.level);
      x.level = d.level;
      x.xp = d.xp;
    });
  }

  /** An item an enemy left goes to the stored profile too — it stays whatever the battle's outcome (solo battle; online the server adds it) */
  static keepItem(def: string, power: number): void {
    storage?.update((x) => { new Profile(x).add(def, power); });
  }

  /** Seeds brought out of an expedition — into the profile */
  addSeeds(b: { common: number; rare: number; golden: number }): void {
    const s = this.data.seeds ??= { common: 0, rare: 0, golden: 0 };
    s.common += Math.max(0, Math.round(b.common)); s.rare += Math.max(0, Math.round(b.rare)); s.golden += Math.max(0, Math.round(b.golden));
    this.save();
  }

  /** Seeds into the stored profile (solo expedition; online the server adds them) */
  static creditSeeds(b: { common: number; rare: number; golden: number }): void {
    if (b.common + b.rare + b.golden <= 0) return;
    storage?.update((x) => { new Profile(x).addSeeds(b); });
  }

  /** A solo mission is over: the ladder and the order of the day into the stored profile (online the server does it) */
  static creditMission(apply: (d: ProfileData) => void): void { storage?.update((x) => { apply(x); }); }

  /** Victory loot into the stored profile's raspberries (solo battle; online the server pays it) */
  static creditStored(n: number): void {
    if (n <= 0) return;
    storage?.update((x) => { x.berries += Math.round(n); });
  }

  save(): void {
    if (this.battleMode) Profile.keepGrowth(this.data);
    for (const f of this.listeners) f();
  }

  onChange(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  /** Start over with the starter kit */
  reset(): void { this.data = Profile.starter(); this.save(); }

  get(uid: string | null | undefined): Item | null { return uid ? this.data.items.find((i) => i.uid === uid) ?? null : null; }

  /** New item into the inventory */
  add(def: string, power: number, isNew = true): Item {
    const d = itemDef(def);
    const uid = `i${++this.data.seq}`;
    const it: Item = { uid, def, power: Math.max(1, Math.round(power)), enchants: rollEnchantSlots(d, rng(hash(uid + def) || 1)), isNew };
    this.data.items.push(it);
    return it;
  }

  /** Random loot around the hero's power: commons more often, uniques rarely. Into the inventory via add once picked up */
  rollLoot(r: Rand = this.rand, slots?: ItemSlot[]): { def: string; power: number } {
    const x = r();
    const rarity: Rarity = x < 0.06 ? 'unique' : x < 0.32 ? 'rare' : 'common';
    // spells drop from bosses only — not from chests and not from merchants
    const of = (rr: Rarity): ItemDef[] => ITEMS.filter((d) => d.rarity === rr && !d.spell && !d.mob && (!slots || slots.includes(d.slot)));
    const pool = of(rarity).length ? of(rarity) : of('common');
    return { def: pool[Math.floor(r() * pool.length)].id, power: Math.max(1, this.power + Math.floor(r() * 3) - 1) };
  }

  /** Buy with raspberries: false — not enough */
  pay(price: number): boolean {
    if (this.data.berries < price) return false;
    this.data.berries -= price;
    this.save();
    return true;
  }

  /** Buy an item: paid, into the inventory at the hero's power; null — not enough raspberries */
  buy(def: string, price: number): Item | null {
    if (!this.pay(price)) return null;
    const it = this.add(def, this.power);
    this.save();
    this.onOp?.({ op: 'buy', def });
    return it;
  }

  /** Buy an arrow bundle; false — not enough raspberries */
  buyArrows(n: number, price: number): boolean {
    if (!this.pay(price)) return false;
    this.addArrows(n);
    this.onOp?.({ op: 'arrows' });
    return true;
  }

  /** Reforging at the blacksmith: +1 item power */
  reforge(uid: string, price: number): boolean {
    const it = this.get(uid);
    if (!it || !this.pay(price)) return false;
    it.power++;
    this.save();
    return true;
  }

  equipped(slot: 'melee' | 'ranged' | 'armor'): Item | null { return this.get(this.data.equip[slot]); }
  artifacts(): (Item | null)[] { return this.data.equip.artifacts.map((u) => this.get(u)); }

  isEquipped(uid: string): boolean {
    const e = this.data.equip;
    return e.melee === uid || e.ranged === uid || e.armor === uid || e.artifacts.includes(uid) || e.aura === uid;
  }

  /** Equip; an artifact goes to slot at or to the first free one (none free — replaces the first) */
  equip(uid: string, at?: number): boolean {
    const it = this.get(uid);
    if (!it) return false;
    const slot = itemDef(it.def).slot, e = this.data.equip;
    if (slot === 'artifact') {
      const was = e.artifacts.indexOf(uid);
      let i = at ?? e.artifacts.indexOf(null);
      if (i < 0) i = 0;
      if (was >= 0) e.artifacts[was] = e.artifacts[i];
      e.artifacts[i] = uid;
    } else if (slot === 'aura') e.aura = uid;
    else e[slot] = uid;
    it.isNew = false;
    this.save();
    this.onOp?.(at === undefined ? { op: 'equip', uid } : { op: 'equip', uid, at });
    return true;
  }

  /** Unequip an artifact from its slot (weapons and armour cannot be unequipped — only replaced) */
  unequipArtifact(i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.data.equip.artifacts.length) return;
    this.data.equip.artifacts[i] = null;
    this.save();
    this.onOp?.({ op: 'unequip', slot: i });
  }

  /** Equipped aura */
  aura(): Item | null { return this.get(this.data.equip.aura); }
  unequipAura(): void { this.data.equip.aura = null; this.save(); this.onOp?.({ op: 'unequip', slot: -1 }); }

  /** Salvage: raspberries and the spent points back. Equipped items cannot be salvaged */
  salvage(uid: string): { berries: number; points: number } | null {
    const it = this.get(uid);
    if (!it || this.isEquipped(uid)) return null;
    const res = { berries: salvageValue(it), points: spentPoints(it) };
    this.data.items = this.data.items.filter((i) => i.uid !== uid);
    this.data.berries += res.berries;
    this.data.points += res.points;
    this.save();
    this.onOp?.({ op: 'salvage', uid });
    return res;
  }

  /** Cost of the next step in the slot (choosing an option = tier I) or null — not allowed */
  nextCost(it: Item, slot: number, option: number): number | null {
    const s = it.enchants[slot];
    if (!s) return null;
    if (s.chosen >= 0 && s.chosen !== option) return null;
    if (s.tier >= 3) return null;
    return enchantCost(enchantDef(s.options[option]), s.tier + 1);
  }

  /** Choose an option in the slot or raise its tier */
  enchant(uid: string, slot: number, option: number): boolean {
    const it = this.get(uid);
    if (!it) return false;
    const cost = this.nextCost(it, slot, option);
    if (cost === null || cost > this.data.points) return false;
    const s = it.enchants[slot];
    s.chosen = option;
    s.tier++;
    this.data.points -= cost;
    this.save();
    this.onOp?.({ op: 'enchant', uid, slot, option });
    return true;
  }

  /** XP; returns how many levels were gained (each — an enchantment point) */
  addXp(n: number): number {
    const d = this.data;
    d.xp += n;
    let ups = 0;
    while (d.xp >= xpToNext(d.level)) { d.xp -= xpToNext(d.level); d.level++; d.points++; ups++; }
    this.save();
    return ups;
  }

  addSouls(n: number): void { this.data.souls = Math.min(MAX_SOULS, this.data.souls + n); }
  addBerries(n: number): void { this.data.berries += n; this.save(); }
  addArrows(n: number): void { this.data.arrows = Math.min(MAX_ARROWS, this.data.arrows + n); this.save(); }

  /** Hero power: the average of weapon, armour, bow and artifacts (as in MCD) */
  get power(): number {
    const p = (it: Item | null): number => it?.power ?? 0;
    const arts = this.artifacts().filter((x): x is Item => !!x);
    const art = arts.length ? arts.reduce((a, x) => a + x.power, 0) / arts.length : 0;
    return Math.max(1, Math.round((p(this.equipped('melee')) + p(this.equipped('armor')) + p(this.equipped('ranged')) + art) / 4));
  }

  /** Strength for the defence balance (src/td/scaling.ts): gear power plus half the level */
  get rating(): number { return this.power + Math.floor((this.data.level - 1) / 2); }

  stats(): GearStats {
    const m = this.equipped('melee'), r = this.equipped('ranged'), a = this.equipped('armor');
    const perk = (k: PerkKind): number => (a ? itemDef(a.def).armor?.perks.filter((p) => p.kind === k).reduce((s, p) => s + p.value, 0) ?? 0 : 0);
    return {
      meleeMult: (m ? powerMult(m.power) : 1) * (1 + (enchantValue(m, 'sharpness') + perk('meleeDmg')) / 100),
      critChance: enchantValue(m, 'critical') / 100,
      leech: enchantValue(m, 'leeching') / 100,
      knockMult: 1 + enchantValue(m, 'knockback') / 100,
      waveMult: 1 + enchantValue(m, 'swirling') / 100,
      fireDmg: enchantValue(m, 'fireAspect'),
      soulsPerHit: 1 + enchantValue(m, 'soulSiphon'),
      smiteChance: enchantValue(m, 'smiting') / 100,
      rangedMult: (r ? powerMult(r.power) : 1) * (1 + (enchantValue(r, 'power') + perk('rangedDmg')) / 100),
      rangedCdMult: 1 - enchantValue(r, 'accelerate') / 100,
      multishot: enchantValue(r, 'multishot') / 100,
      infinity: enchantValue(r, 'infinity') / 100,
      rangedKnock: 1 + enchantValue(r, 'punch') / 100,
      pierce: enchantValue(r, 'piercing'),
      maxHpBonus: (a ? armorHealth(a) : 0) + enchantValue(a, 'health'),
      soulsMult: 1 + (perk('souls') + enchantValue(a, 'soulGather')) / 100,
      artifactCdMult: Math.max(0.3, 1 - (perk('cooldown') + enchantValue(a, 'cooldown')) / 100),
      artifactMult: 1 + perk('artifactDmg') / 100,
      potionMult: 1 + (perk('potion') + enchantValue(a, 'potionBoost')) / 100,
      rollCdMult: Math.max(0.3, 1 - (perk('roll') + enchantValue(a, 'acrobat')) / 100),
      regen: enchantValue(a, 'regen'),
      speedMult: 1 + perk('speed') / 100,
      arrowBundle: ARROW_BUNDLE + perk('arrows'),
    };
  }
}
