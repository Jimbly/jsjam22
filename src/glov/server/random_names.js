// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const { floor, random } = Math;

const adj = [
  'Adamant','Adroit','Amatory','Animistic','Antic','Arcadian','Baleful','Bearded',
  'Bellicose','Bilious','Boorish','Calamitous','Caustic','Cerulean','Comely',
  'Concomitant','Contumacious','Corpulent','Crapulous','Cromulent','Defamatory','Didactic',
  'Dilatory','Dowdy','Efficacious','Effulgent','Egregious','Endemic','Equanimous',
  'Execrable','Fastidious','Feckless','Fecund','Friable','Fulsome','Garrulous',
  'Guileless','Gustatory','Heuristic','Histrionic','Hubristic','Incendiary',
  'Insidious','Insolent','Intransigent','Inveterate','Invidious','Irksome',
  'Jejune','Jocular','Judicious','Lachrymose','Limpid','Loquacious','Luminous',
  'Mannered','Mendacious','Meretricious','Minatory','Mordant','Munificent',
  'Nefarious','Noxious','Obtuse','Parsimonious','Pendulous','Pernicious',
  'Pervasive','Petulant','Platitudinous','Precipitate','Propitious','Puckish',
  'Querulous','Quiescent','Rebarbative','Recalcitrant','Redolent','Rhadamanthine',
  'Risible','Ruminative','Sagacious','Salubrious','Sartorial','Sclerotic',
  'Serpentine','Slumberous','Spasmodic','Strident','Taciturn','Tenacious','Tremulous',
  'Trenchant','Turbulent','Turgid','Ubiquitous','Uxorious','Verdant','Voluble',
  'Voracious','Wheedling','Withering','Zealous',
];
const nadj = adj.length;
const noun = [
  'Alligator','Bear','Dragon','Heron','Chihuahua','Collie','Cougar','Dog','Eagle',
  'Egret','Elephant','Falcon','Gallinule','Goldendoodle','Goldfinch',
  'Guinea Pig','Hamster','Horned Owl','Hornet','Ibis','Kitten','Kookaburra',
  'Leopard','Limpkin','Lion','Longwing','Macaw','Meerkat','Monkey','Owl',
  'Bunting','Panda','Panther','Peafowl','Penguin',
  'Puppy','Rabbit','Raccoon','Schipperke','Seal','Softshell',
  'Squirrel','Starling','Stork','Sunbittern','Swallowtail','Tiger','Tortoise',
  'Wolf','Zebra'
];
let nnoun = noun.length;

export function get() {
  return `${adj[floor(random() * nadj)]} ${noun[floor(random() * nnoun)]}`;
}
