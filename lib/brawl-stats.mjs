import crypto from 'node:crypto';

const asNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const cleanTag = (value) => String(value || '').replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
const cleanText = (value, max = 100) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/** Normaliza somente campos presentes no perfil oficial; campos ausentes permanecem null. */
export function normalizePlayerStats(player = {}) {
  const brawlers = Array.isArray(player.brawlers) ? player.brawlers : [];
  const club = player.club && typeof player.club === 'object' ? {
    name: cleanText(player.club.name, 80) || null,
    tag: cleanText(player.club.tag, 24) || null,
  } : null;
  return {
    highestTrophies: asNumber(player.highestTrophies),
    experienceLevel: asNumber(player.expLevel),
    experiencePoints: asNumber(player.expPoints),
    victories3v3: asNumber(player['3vs3Victories']),
    victoriesSolo: asNumber(player.soloVictories),
    victoriesDuo: asNumber(player.duoVictories),
    bestRoboRumbleTime: asNumber(player.bestRoboRumbleTime),
    bestTimeAsBigBrawler: asNumber(player.bestTimeAsBigBrawler),
    championshipQualified: typeof player.isQualifiedFromChampionshipChallenge === 'boolean' ? player.isQualifiedFromChampionshipChallenge : null,
    club,
    brawlerCount: Array.isArray(player.brawlers) ? brawlers.length : null,
    maxBrawlerTrophies: brawlers.length ? brawlers.reduce((max, b) => Math.max(max, asNumber(b?.trophies) ?? 0), 0) : null,
    maxBrawlerName: brawlers.length ? (brawlers.slice().sort((a, b) => (asNumber(b?.trophies) ?? -1) - (asNumber(a?.trophies) ?? -1))[0]?.name || null) : null,
  };
}

function flattenBattlePlayers(battle) {
  const direct = Array.isArray(battle?.players) ? battle.players : [];
  const teams = Array.isArray(battle?.teams) ? battle.teams.flatMap((team) => Array.isArray(team) ? team : []) : [];
  return [...direct, ...teams];
}

/** Extrai a participação do próprio membro. Não atribui o Brawler de outro jogador. */
export function extractBattleRecord(item, playerTag, memberId) {
  const battle = item?.battle || {};
  const self = flattenBattlePlayers(battle).find((player) => cleanTag(player?.tag) === cleanTag(playerTag));
  const hasPlayerList = (Array.isArray(battle.players) && battle.players.length > 0) || (Array.isArray(battle.teams) && battle.teams.some(team => Array.isArray(team) && team.length > 0));
  const brawlerName = cleanText(self?.brawler?.name || (!hasPlayerList ? battle.brawler?.name : ''), 80);
  if (!brawlerName) return null;
  const battleTime = cleanText(item?.battleTime, 32) || null;
  const mode = cleanText(battle.mode, 50) || null;
  const type = cleanText(battle.type, 50) || null;
  const map = cleanText(item?.event?.map || battle.map, 80) || null;
  const rank = asNumber(battle.rank);
  const explicitResult = cleanText(battle.result, 24).toLowerCase() || null;
  const result = explicitResult || (rank === 1 ? 'victory' : rank !== null ? 'placement' : null);
  const trophyChange = asNumber(battle.trophyChange);
  const identity = [battleTime, mode, type, map, brawlerName, result, rank, trophyChange].join('|');
  const fingerprint = crypto.createHash('sha256').update(`${cleanTag(playerTag)}|${identity}`).digest('hex');
  return {
    id: `${memberId}_${fingerprint}`,
    memberId,
    battleTime,
    brawlerName,
    mode,
    type,
    map,
    result,
    rank,
    trophyChange,
    observedAt: new Date().toISOString(),
  };
}

export function extractBattleRecords(items, playerTag, memberId) {
  if (!Array.isArray(items)) return [];
  const unique = new Map();
  for (const item of items) {
    const record = extractBattleRecord(item, playerTag, memberId);
    if (record) unique.set(record.id, record);
  }
  return [...unique.values()];
}

export function aggregateBattleStats(records = []) {
  const brawlers = new Map();
  const modes = new Map();
  let wins = 0, losses = 0, draws = 0;
  for (const battle of records) {
    if (battle.brawlerName) brawlers.set(battle.brawlerName, (brawlers.get(battle.brawlerName) || 0) + 1);
    if (battle.mode) modes.set(battle.mode, (modes.get(battle.mode) || 0) + 1);
    if (battle.result === 'victory' || battle.result === 'win') wins++;
    else if (battle.result === 'defeat' || battle.result === 'loss') losses++;
    else if (battle.result === 'draw') draws++;
  }
  const sortCounts = (map, key) => [...map].map(([name, count]) => ({ name, [key]: count })).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
  return { totalObserved: records.length, wins, losses, draws, brawlers: sortCounts(brawlers, 'count'), modes: sortCounts(modes, 'count') };
}
