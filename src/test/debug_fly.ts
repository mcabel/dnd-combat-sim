import { loadBestiaryJson, monsterToCombatant } from '../parser/fivetools';
import { grantIndependence } from '../summons/mount';
import * as fs from 'fs';
import * as path from 'path';

const candidates = [
  path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
  '/mnt/project/bestiary-dmg.json',
];
const bestiaryPath = candidates.find(p => fs.existsSync(p))!;
const rawBestiary = JSON.parse(fs.readFileSync(bestiaryPath, 'utf-8'));
const map = loadBestiaryJson(rawBestiary);

const flyRaw = map.get('giant fly');
if (!flyRaw) { console.log('Giant Fly not found'); process.exit(1); }
const fly = monsterToCombatant(flyRaw, { x: 0, y: 0, z: 0 }, 'attackNearest');
console.log('=== Giant Fly ===');
console.log('Actions count:', fly.actions.length);
fly.actions.forEach((a: any) => console.log(` - ${a.name}: attackType=${a.attackType} hitBonus=${a.hitBonus} damage=${JSON.stringify(a.damage)}`));
console.log('Speed:', fly.speed, '| flySpeed:', fly.flySpeed);
console.log('hasHands:', fly.hasHands, '| isDefender:', fly.isDefender, '| cannotAttack:', fly.cannotAttack);
grantIndependence(fly);
console.log('independentMount:', fly.independentMount);

// Also check Warhorse if MM is available
const mmPath = candidates[0].replace('bestiary-dmg', 'bestiary-mm-2014');
if (fs.existsSync(mmPath)) {
  const mmRaw = JSON.parse(fs.readFileSync(mmPath, 'utf-8'));
  const mmMap = loadBestiaryJson(mmRaw);
  const horseRaw = mmMap.get('warhorse');
  if (horseRaw) {
    const horse = monsterToCombatant(horseRaw, { x: 0, y: 0, z: 0 }, 'attackNearest');
    console.log('\n=== Warhorse ===');
    console.log('Actions count:', horse.actions.length);
    horse.actions.forEach((a: any) => console.log(` - ${a.name}: attackType=${a.attackType} hitBonus=${a.hitBonus} damage=${JSON.stringify(a.damage)}`));
    console.log('Speed:', horse.speed, '| flySpeed:', horse.flySpeed);
    console.log('hasHands:', horse.hasHands);
  }
}
