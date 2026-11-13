import { t } from '../i18n/i18n.ts';

/**
 * Tutorial cards (wiki/design-tutorial.md): one card — one idea. A card pops up the first time its mechanic shows up
 * (src/tutorial/tutorial.ts `fire`) and stays in the "How to play" handbook. `marks` are the numbered rings drawn on the
 * card's screenshot (scripts/shots, public/tutorial/<lang>/<id>.webp) — their order here is the order of the numbers there.
 */
export type TutGroup = 'camp' | 'td' | 'exp' | 'online';

export interface TutCard {
  id: string;
  group: TutGroup;
  title: string;
  lines: string[];
  marks: string[];
  /** Shown ahead of the queue, with no gap: the thing is happening right now */
  urgent?: boolean;
  /** Part of the opening run of a battle: follows the previous card at once */
  chain?: boolean;
}

export const GROUP_TITLE: Record<TutGroup, string> = { camp: t('Camp'), td: t('Bush Defence'), exp: t('Expeditions'), online: t('Online') };
export const GROUPS: readonly TutGroup[] = ['camp', 'td', 'exp', 'online'];

export const CARDS: readonly TutCard[] = [
  // ---------- camp ----------
  { id: 'camp.gear', group: 'camp', title: t('Your camp'),
    lines: [t('Here the hero gets ready for battle. Everything won in battles comes back to the camp.')],
    marks: [t('Tabs: Gear, Map, Expeditions — switch with Q and E'), t('Gear slots — click a slot, then I to change the item'), t('Raspberries pay for new gear in the Shop (B)'), t('Start game — Enter')] },
  { id: 'camp.items', group: 'camp', title: t('All items'),
    lines: [t('Everything the hero owns. Fresh finds carry a mark until you look at them.')],
    marks: [t('Pick an item — Enter or a double click equips it'), t('The item card: power, perks and enchantments bought with level points'), t('Salvage (X) takes apart an item you do not need')] },
  { id: 'camp.map', group: 'camp', title: t('Choose a map'),
    lines: [t('Five Bush Defence maps, all open from the start. Begin with the first one — it is the gentlest.')],
    marks: [t('Map tiles: ◆ shows the difficulty, "won" marks a beaten map'), t('The chosen map: waves, lanes and what is special about it')] },
  { id: 'camp.exp', group: 'camp', title: t('Expeditions'),
    lines: [t('A sortie into the Order\'s forest: do the objective, gather seeds and leave by balloon.')],
    marks: [t('Difficulty — a won mission opens the next step'), t('Three operations of the day, each a chain of missions'), t('The sketch of the map: pick a landing with 1, 2 or 3'), t('Camp beds: plant the seeds you bring out for lasting bonuses')] },
  { id: 'camp.rooms', group: 'online', title: t('Play together'),
    lines: [t('Up to four heroes defend one bush or go on an expedition together.')],
    marks: [t('Create a room — friends join by its code'), t('The room list — double click to join'), t('Friends and the room chat; T turns the microphone on')] },

  // ---------- Bush Defence ----------
  { id: 'td.move', group: 'td', chain: true, title: t('Move and fight'),
    lines: [t('Left click on the ground — the hero walks there. Left click on an enemy — he runs up and strikes; hold the button for a combo.'), t('WASD walks too, Space is a dodge roll, the right button shoots the bow.')],
    marks: [t('Your hero'), t('The raspberry bush — the Order must not reach it'), t('Health: the heart empties as you take hits')] },
  { id: 'td.build', group: 'td', chain: true, title: t('Build towers'),
    lines: [t('Towers hold the lanes while you fight. Walk up to a pad and press F, or just click the pad.')],
    marks: [t('A free pad'), t('Pick a tower with the digit keys — each costs raspberries'), t('Your raspberries')] },
  { id: 'td.wave', group: 'td', chain: true, title: t('Waves'),
    lines: [t('The Order comes in waves. Between waves there is time to build and to shop.')],
    marks: [t('The wave number and the time until the next one — G calls it now for a bonus'), t('Who comes next'), t('The bush\'s health: if it withers, the battle is lost')] },
  { id: 'td.berries', group: 'td', title: t('Raspberries'),
    lines: [t('Fallen enemies drop raspberries. Come close and they fly to you by themselves.')],
    marks: [t('Raspberries on the ground'), t('Your purse: towers, upgrades and the sutler'), t('Loot goes home to the camp — if the bush holds')] },
  { id: 'td.sutler', group: 'td', title: t('The sutler'),
    lines: [t('Press F next to the sutler: weapons, armour, spells and auras for the raspberries earned in this battle.'), t('Purchases serve until the end of the battle — towers or the hero, your call.')],
    marks: [t('The sutler'), t('F — trade')] },
  { id: 'td.skills', group: 'td', title: t('Abilities'),
    lines: [t('The bar at the bottom is the hero\'s arsenal. A wave is beaten — a good moment to look at it.')],
    marks: [t('1, 2, 3 — artifacts and spells; hold a key to charge'), t('E — the healing potion'), t('Q — the weapon art, it fills as you strike; R — the aura flare')] },
  { id: 'td.level', group: 'td', title: t('A new level'),
    lines: [t('Fights give experience. Every level brings an enchantment point.'), t('Open the inventory (I) and spend it on an item — the battle waits meanwhile.')],
    marks: [t('The level and the experience bar')] },
  { id: 'td.chief', group: 'td', urgent: true, title: t('A mini-boss'),
    lines: [t('A chief leads this wave: tougher and stronger than the rest. The banner names his lane.'), t('Meet him by your towers and do not spare the artifacts.')],
    marks: [] },
  { id: 'td.hunters', group: 'td', urgent: true, title: t('Tower hunters'),
    lines: [t('Some enemies go for the towers: gnawers chew them down, sorcerers freeze them. Run there and strike the hunter.')],
    marks: [t('The alarm: which tower, the arrow and the distance'), t('The same tower on the minimap')] },
  { id: 'td.repair', group: 'td', urgent: true, title: t('A tower has fallen'),
    lines: [t('The ruins stay on the pad. Walk up and press F — the tower is rebuilt for raspberries, cheaper than a new one.')],
    marks: [t('The ruins')] },
  { id: 'td.down', group: 'td', urgent: true, title: t('The hero fell'),
    lines: [t('No harm done: in a couple of seconds the hero is back on his feet.'), t('But the bush stands unguarded meanwhile. Watch the heart and drink the potion (E) in time.')],
    marks: [] },
  { id: 'td.lava', group: 'td', urgent: true, title: t('Lava'),
    lines: [t('Lava burns the hero and a dodge roll does not help — get back to the shore. Enemies walk the lanes, so there is no need to wade in.')],
    marks: [] },
  { id: 'td.walls', group: 'td', title: t('Walls and gates'),
    lines: [t('On this map the bush stands behind walls. The Order breaks them to get in.'), t('F at a damaged wall or gate repairs it for raspberries.')],
    marks: [t('The state of the walls')] },
  { id: 'td.lanterns', group: 'td', title: t('Lanterns and mist'),
    lines: [t('Lanterns hold the mist back. F lights a lantern or tops it up.'), t('Wisps flicker in the mist — catch one for raspberries.')],
    marks: [t('A lantern')] },

  // ---------- expeditions ----------
  { id: 'exp.goal', group: 'exp', chain: true, title: t('An expedition'),
    lines: [t('There is no bush to guard here: the squad goes to the objective itself, then leaves by balloon.')],
    marks: [t('The objective and how much of it is done'), t('The arrow and the distance to the next place'), t('The map: objective sites and the balloon pad')] },
  { id: 'exp.parcels', group: 'exp', title: t('Parcels from the camp'),
    lines: [t('Z, X and C call a parcel to the spot you aim at: a tower, a volley or a healing totem. Each one rests after use.'), t('Which parcels to take is chosen in the camp, under the gear.')],
    marks: [t('The parcels and their rest time')] },
  { id: 'exp.alarm', group: 'exp', urgent: true, title: t('The alarm'),
    lines: [t('The longer the squad stays, the higher the alarm and the stronger the Order. Do not linger.')],
    marks: [t('The alarm: four steps')] },
  { id: 'exp.horn', group: 'exp', urgent: true, title: t('A horn-blower'),
    lines: [t('A patrol has spotted the squad and its horn-blower raises the horn. Strike him down before he calls — or reinforcements come and the alarm jumps.')],
    marks: [] },
  { id: 'exp.seeds', group: 'exp', title: t('Seeds'),
    lines: [t('Seeds are the treasure of an expedition. They count only when carried out by balloon.'), t('In the camp they are planted in the beds.')],
    marks: [t('Seeds in the bag: common, rare, golden')] },
  { id: 'exp.totems', group: 'exp', urgent: true, title: t('Raspberry totems'),
    lines: [t('A fallen hero is lifted by a raspberry totem. The squad shares them, and they do run out.'), t('A teammate standing next to the fallen lifts him sooner and saves the totem.')],
    marks: [t('Totems left')] },
  { id: 'exp.dusk', group: 'exp', urgent: true, title: t('Dusk'),
    lines: [t('Night is falling and the alarm now grows twice as fast. Finish up and head for the balloon.')],
    marks: [] },
  { id: 'exp.balloon', group: 'exp', urgent: true, title: t('The balloon'),
    lines: [t('The objective is done! Follow the arrow to the pad and press F to call the balloon.'), t('Hold the pad until it lands, then everyone gets on board.')],
    marks: [t('The arrow to the balloon pad')] },
];

export const CARD: ReadonlyMap<string, TutCard> = new Map(CARDS.map((c) => [c.id, c]));
