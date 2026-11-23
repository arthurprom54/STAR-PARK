import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateBattleStats,extractBattleRecord,extractBattleRecords,normalizePlayerStats} from '../lib/brawl-stats.mjs';

test('normaliza todos os indicadores de perfil sem converter dados ausentes em zero',()=>{
 const stats=normalizePlayerStats({trophies:24500,highestTrophies:26000,expLevel:180,expPoints:123456,'3vs3Victories':9000,soloVictories:1200,duoVictories:1800,bestRoboRumbleTime:15,bestTimeAsBigBrawler:42,isQualifiedFromChampionshipChallenge:true,club:{name:'Star Team',tag:'ABC'},brawlers:[{name:'Shelly',trophies:900},{name:'Colt',trophies:1000}]});
 assert.equal(stats.highestTrophies,26000);assert.equal(stats.experienceLevel,180);assert.equal(stats.experiencePoints,123456);
 assert.equal(stats.victories3v3,9000);assert.equal(stats.victoriesSolo,1200);assert.equal(stats.victoriesDuo,1800);
 assert.equal(stats.brawlerCount,2);assert.equal(stats.maxBrawlerName,'Colt');assert.equal(stats.maxBrawlerTrophies,1000);assert.equal(stats.club.name,'Star Team');
 const missing=normalizePlayerStats({});assert.equal(missing.highestTrophies,null);assert.equal(missing.victories3v3,null);assert.equal(missing.experienceLevel,null);assert.equal(missing.brawlerCount,null);assert.equal(missing.maxBrawlerTrophies,null);
});

test('captura apenas o Brawler do próprio membro e identifica vitória por colocação quando aplicável',()=>{
 const item={battleTime:'20261122T220000.000Z',event:{map:'Brawl Ball Arena'},battle:{mode:'soloShowdown',type:'ranked',rank:1,trophyChange:8,teams:[[{tag:'#PYLQG',name:'Player A',brawler:{id:16000000,name:'Shelly'}},{tag:'#QRGPL',name:'Player B',brawler:{id:16000001,name:'Colt'}}]]}};
 const own=extractBattleRecord(item,'PYLQG','member-1');assert.ok(own);assert.equal(own.brawlerName,'Shelly');assert.equal(own.result,'victory');assert.equal(own.mode,'soloShowdown');
 assert.equal(extractBattleRecord(item,'ZZZZZZ','member-2'),null);
});

test('remove duplicatas do Battle Log e agrega uso, modos e resultados',()=>{
 const base={battleTime:'20261122T220000.000Z',event:{map:'Mapa'},battle:{mode:'brawlBall',type:'ranked',result:'victory',trophyChange:8,players:[{tag:'#PYLQG',brawler:{name:'Shelly'}}]}};
 const records=extractBattleRecords([base,base,{...base,battleTime:'20261122T221000.000Z',battle:{...base.battle,mode:'gemGrab',result:'defeat',players:[{tag:'#PYLQG',brawler:{name:'Colt'}}]}}],'PYLQG','m1');
 assert.equal(records.length,2);
 const stats=aggregateBattleStats(records);assert.equal(stats.totalObserved,2);assert.equal(stats.wins,1);assert.equal(stats.losses,1);assert.equal(stats.brawlers.length,2);assert.equal(stats.modes.length,2);
});

test('captura Brawler em formatos solo que retornam battle.brawler sem lista de jogadores',()=>{
 const item={battleTime:'20261122T223000.000Z',event:{map:'Showdown'},battle:{mode:'soloShowdown',rank:2,brawler:{name:'Poco'}}};
 const record=extractBattleRecord(item,'PYLQG','member-solo');assert.ok(record);assert.equal(record.brawlerName,'Poco');assert.equal(record.result,'placement');
});
