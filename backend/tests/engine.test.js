import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/game/engine.js';

const hand = (...ranks) => ranks.map(rank => ({ rank: String(rank), suit: 'spades' }));
const shoeFor = (...ranks) => hand(...ranks).reverse();
const start = (...ranks) => engine.createRound([{ id: 'human', username: 'Student' }], 'single', shoeFor(...ranks));

test('six decks contain 312 cards, 24 of each rank, and shuffle preserves cards', () => {
  const shoe = engine.createShoe();
  assert.equal(shoe.length, 312);
  assert.equal(shoe.filter(card => card.rank === 'A').length, 24);
  assert.deepEqual(engine.shuffleCards(shoe).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [...shoe].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert.equal(shoe.length, 312);
  assert.throws(() => engine.drawCard([]), /empty/);
});

for (const [ranks, total, soft] of [
  [['A','A'],12,true], [['A','A','9'],21,true], [['A','A','9','K'],21,false],
  [['A','6'],17,true], [['K','9','3'],22,false], [Array(20).fill('A'),20,false],
  [['A','A','A','A','A','A','2'],18,true],
]) {
  test(`scoring ${ranks.join(',')} = ${total}, usable Ace ${soft}`, () => {
    assert.equal(engine.calculateHandTotal(hand(...ranks)),total);
    assert.equal(engine.hasUsableAce(hand(...ranks)),soft);
  });
}

test('natural detection requires exactly two cards', () => {
  assert.equal(engine.isNaturalBlackjack(hand('A','Q')),true);
  assert.equal(engine.isNaturalBlackjack(hand('7','7','7')),false);
});

for (const [player, dealer, result] of [
  [['A','K'],['7','7','7'],'win'], [['7','7','7'],['A','Q'],'loss'],
  [['A','K'],['A','Q'],'push'], [['10','8'],['9','9'],'push'],
  [['10','9','4'],['10','8','5'],'loss'], [['10','8'],['10','8','5'],'win'],
  [['10','6'],['10','7'],'loss'],
]) test(`result ${player} / ${dealer}: ${result}`, () => {
  assert.equal(engine.determineRoundResult(hand(...player),hand(...dealer)),result);
});

test('dealer stands on soft 17 and hits hard 16', () => {
  const soft = hand('A','6'); const shoe = hand('5');
  engine.executeDealerTurn(soft,shoe);
  assert.equal(soft.length,2);
  const hard=hand('10','6'); engine.executeDealerTurn(hard,shoe);
  assert.equal(engine.calculateHandTotal(hard),21);
});

test('dealing, hidden serialization, hit, stand and completion', () => {
  const game=start('5','10','6','7','4');
  assert.equal(game.players[0].hand.length,2);
  assert.equal(game.dealerHand.length,2);
  const view=engine.publicGame(game);
  assert.equal(view.dealer.total,null);
  assert.deepEqual(view.dealer.hand[1],{hidden:true});
  assert.equal('shoe' in view,false);
  engine.applyAction(game,'human','HIT',game.id,0);
  assert.equal(game.players[0].hand.length,3);
  assert.throws(() => engine.applyAction(game,'human','HIT',game.id,0),/changed/);
  engine.applyAction(game,'human','STAND',game.id,1);
  assert.equal(game.status,'complete');
  assert.equal(engine.publicGame(game).dealer.total,17);
  assert.deepEqual(engine.determineLegalActions(game,'human'),[]);
  assert.throws(() => engine.processHit(game,'human'),/turn/);
});

test('bust and 21 automatically end turns; dealer natural resolves immediately', () => {
  const busted=start('10','10','6','7','K'); engine.processHit(busted,'human');
  assert.equal(busted.status,'complete'); assert.equal(busted.players[0].result,'loss');
  const twentyOne=start('10','10','6','7','5'); engine.processHit(twentyOne,'human');
  assert.equal(twentyOne.status,'complete');
  const natural=start('9','A','9','K'); assert.equal(natural.status,'complete');
});

test('turn ordering rejects another player, invalid actions and old rounds', () => {
  const game=engine.createRound([{id:'one'},{id:'two'}],'multi',shoeFor('5','6','10','6','7','7'));
  assert.throws(() => engine.processStand(game,'two'),/turn/);
  assert.throws(() => engine.applyAction(game,'one','SPLIT',game.id,0),/HIT or STAND/);
  assert.throws(() => engine.applyAction(game,'one','HIT','old',0),/changed/);
  engine.processStand(game,'one'); assert.equal(game.players[game.currentPlayerIndex].id,'two');
  engine.standDisconnectedPlayer(game,'two'); assert.equal(game.status,'complete');
});

test('features contain only own hand and visible upcard, including >6 cards', () => {
  assert.deepEqual(engine.predictionFeatures(hand('A','A','A','A','A','A','2'),hand('Q')[0]),
    {total:18,dealer:10,soft:1,cards:7});
});
