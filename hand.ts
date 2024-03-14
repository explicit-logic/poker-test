import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  CardGroup,
  OddsCalculator,
  type Card as PokerToolsCard,
} from "poker-tools";

/*
"♣" - c, "clubs",
"♠" - s, "spades",
"♦" - d, "diamonds",
"♥" - h, "hearts",

A - Ace
T - 10
J - Jack
Q - Queen
K - King
*/

const areSetsEqual = <T>(a: Set<T>, b: Set<T>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

// Готовая функция для перемешивания колоды
export function shuffle<T>(array: Array<T>) {
  let currentIndex = array.length,
    randomIndex;

  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // @ts-expect-error This is fine.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}

// Функция сна
// Спать надо
// * на 1 секунду - после раздачи карт игрокам
// * на 1 секунду - после раздачи 3х карт на стол
// * на 1 секунду - после раздачи 4й карты на стол
// * на 1 секунду - после раздачи 5й карты на стол
// * на 1 секунду - после раздачи каждого выигрыша
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Card = string;
type PlayerAction =
  | {
      type: "fold";
    }
  | {
      type: "bet";
      amount: number;
    };

// Функция генерации новой колоды
// Возвращает массив из 52 карт
// Каждая карта - строка из 2х символов
// Первый символ - номер карты
// Второй символ - масть карты
function generateNewDeck() {
  const suits = "hdcs";
  const numbers = "A23456789TJQK";

  const deck = [...suits]
    .map((suit) => [...numbers].map((number) => `${number}${suit}`))
    .flat();

  return shuffle(deck);
}

function givePots(winners: {
  // Идентификаторы игроков которые выиграли этот банк
  playerIds: PlayerId[];
  // Карты, благодаря которым банк выигран (они подсвечиваются при выигрыше)
  winningCards: Card[];
  // Уникальный идентификатор банка
  potId: string;
}): void {

}

type PlayerId = string;
type GameConfigType = {
  smallBlind: number;
  bigBlind: number;
  antes: number;
  timeLimit: number;
};
type Pot = {
  potId: string;
  amount: number;
  eligiblePlayers: Set<PlayerId>;
};
type Seat = {
  playerId: PlayerId;
  stack: number;
};
type CurrencyType = number;

export interface HandInterface {
  getState(): {
    // Карты на столе
    communityCards: Card[];
    // Карты игроков
    holeCards: Record<PlayerId, [Card, Card]>;
    // Банки на столе. potId - произвольный уникальный идентификатор
    pots: { potId: string; amount: number }[];
    // Ставки игроков в текущем раунде
    bets: Record<PlayerId, number>;
    // На сколько игроки должны поднять ставку, чтобы сделать минимальный рейз
    minRaise: CurrencyType;
  };
  start(): void;
  // Генерирует исключение если игрок пробует походить не  в свой ход
  act(playerId: PlayerId, action: PlayerAction): void;
  isValidBet(playerId: PlayerId, amount: number): boolean;
  getSeatByPlayerId(playerId: PlayerId): Seat | undefined;
}

export class Hand implements HandInterface {
  readonly minSeats: number = 2;
  readonly rounds: string[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

  #actedPlayers: Record<PlayerId, boolean> = {};
  #foldedPlayers: Record<PlayerId, boolean> = {};
  #playerQueue: PlayerId[] = [];
  #roundNumber: number = 0;

  #bets: Record<PlayerId, number> = {};
  #communityCards: Card[] = [];
  #deck: string[] = [];
  #sleep: (ms: number) => Promise<unknown>;
  #givePots: (winners: {
    playerIds: PlayerId[];
    winningCards: Card[];
    potId: string;
  }) => void;
  #holeCards: Record<PlayerId, [Card, Card]> = {};
  #pots: Pot[] = [];

  #minRaise: number = 0;

  #seats: Seat[] = [];
  #gameConfig: GameConfigType;

  constructor(
    // Игроки за столом. Первый игрок - дилер
    // Можете считать что у всех игроков есть хотя бы 1 фишка
    seats: Seat[],
    gameConfig: GameConfigType,
    injections: {
      // Функция генерации колоды, значение по умолчанию - generateNewDeck
      makeDeck?: () => string[];
      // Функция сна, значение по умолчанию - sleep
      sleep?: (ms: number) => Promise<unknown>;
      // Функция вызываемая когда надо выдать банк игрокам
      givePots?: (winners: {
        // Идентификаторы игроков которые выиграли этот банк
        playerIds: PlayerId[];
        // Карты, благодаря которым банк выигран (они подсвечиваются при выигрыше)
        winningCards: Card[];
        // Уникальный идентификатор банка
        potId: string;
      }) => void;
    } = {}
  ) {
    this.#actedPlayers = {};
    this.#foldedPlayers = {};
    this.#playerQueue = [];

    this.#seats = seats;
    this.#gameConfig = gameConfig;

    this.#bets = {};
    this.#communityCards = [];
    this.#holeCards = {};

    this.#deck = (injections.makeDeck ?? generateNewDeck)();
    this.#sleep = injections.sleep ?? sleep;
    this.#givePots = injections.givePots ?? givePots;
  }

  getState() {
    return {
      // Карты на столе
      communityCards: this.#communityCards,
      // Карты игроков
      holeCards: this.#holeCards,
      // Банки на столе. potId - произвольный уникальный идентификатор
      pots: this.#pots,
      // Ставки игроков в текущем раунде
      bets: this.#bets,
      // На сколько игроки должны поднять ставку, чтобы сделать минимальный рейз
      minRaise: this.#minRaise,
    }
  }

  start() {
    void this.#bettingRound();
  }

  async #bettingRound() {
    const roundName = this.rounds[this.#roundNumber] ?? '';

    if (Object.values(this.#bets).length > 0) {
      this.#moveBetsToPots();
      await this.#sleep(1000);
    }

    this.#actedPlayers = {};
    this.#minRaise = 0;
    this.#playerQueue = this.#seats.map(({ playerId }) => playerId);

    const roundHandlers: { [key: string]: () => void } = {
      preflop: () => this.#preflop(),
      flop: () => this.#flop(),
      turn: () => this.#turn(),
      river: () => this.#river(),
      showdown: () => this.#showdown(),
    };

    const handler = roundHandlers[roundName] ?? (() => {});

    await handler();

    if (this.#roundNumber < this.rounds.length) {
      this.#roundNumber++;
      const playersInGame = this.#seats.filter((seat) => seat.stack > 0).length;

      if (playersInGame <= 1) {
        setTimeout(() => {
          void this.#bettingRound();
        });
      }
    }
  }

  #flop() {
    this.#communityCards = this.#deal(3);
  }

  #turn() {
    this.#communityCards.push(...this.#deal(1));
  }

  #river() {
    this.#communityCards.push(...this.#deal(1));
  }

  act(playerId: PlayerId, action: PlayerAction): void {
    const { type } = action;

    if (!this.#playerQueue.includes(playerId)) {
      throw new Error('Can\'t act');
    }

    if (type === 'bet') {
      this.#bet(playerId, { amount: action.amount });
    }

    if (type === 'fold') {
      this.#fold(playerId);
    }

    const maxBet = this.getMaxBet();

    this.#actedPlayers[playerId] = true;

    this.#playerQueue = [];
    for (const seat of this.#seats) {
      const bet = this.#bets[seat.playerId] ?? 0;
      if (
        !this.#foldedPlayers[seat.playerId]
        && (!this.#actedPlayers[seat.playerId] || bet < maxBet) 
        && seat.stack > 0
      ) {
        this.#playerQueue.push(seat.playerId);
      }
    }

    if (!this.#playerQueue.length) {
      this.#bettingRound();
    }
  }

  #bet(playerId: PlayerId, { amount }: { amount: number }) {
    const seat = this.getSeatByPlayerId(playerId);
    if (!seat) {
      throw new Error(`Invalid player: ${playerId}`);
    }
    const currentBet = (this.#bets[playerId] ?? 0) + amount;

    if (!this.isValidBet(playerId, amount)) {
      throw new Error(`Invalid bet: ${playerId}, ${amount}`);
    }

    const maxBet = this.getMaxBet();

    if (currentBet >= maxBet + this.#minRaise) {
      this.#minRaise = currentBet - maxBet;
    }

    this.#makeBet(playerId, amount);
  }

  #makeBet(playerId: PlayerId, amount: number) {
    const seat = this.getSeatByPlayerId(playerId);
    if (!seat) {
      throw new Error(`Invalid player: ${playerId}`);
    }
    assert(amount >= 0, "Amount must be positive");
    assert(seat.stack >= amount, "Not enough money");
    const currentBet = (this.#bets[playerId] ?? 0) + amount;
    this.#bets[playerId] = currentBet;
    seat.stack -= amount;
  }

  #deal(amount: number = 1): Card[] {
    return this.#deck.splice(0, amount);
  }

  #fold (playerId: PlayerId) {
    delete this.#holeCards[playerId];
    this.#foldedPlayers[playerId] = true;
    this.#pots.forEach((pot) => {
      pot.eligiblePlayers.delete(playerId);
    });
  }

  isValidBet(playerId: PlayerId, amount: number) {
    const currentBet = (this.#bets[playerId] ?? 0) + amount;
    const seat = this.getSeatByPlayerId(playerId);
    const stack = seat?.stack ?? 0;
    const maxBet = this.getMaxBet();
    const maxCallIn = this.getMaxCallIn();

    /// all-in
    if (amount === stack) {
      return true;
    }

    if (currentBet === maxCallIn) {
      // Matching biggest call-in on the table is always allowed
      return true;
    }

    if (currentBet === maxBet) {
      // This is either check or call
      return true;
    }

    if (currentBet >= this.#minRaise + maxBet) {
      // Normal raise
      return true;
    }

    return false;
  };

  getMaxBet(): number {
    return Math.max(0, ...Object.values(this.#bets));
  }

  getMaxCallIn() {
    const callIns = this.#seats.filter((seat) => seat.stack === 0)
    if (!callIns.length) return -1;
    const maxCallIn = Math.max(
      ...callIns.map((seat) => this.#bets[seat.playerId] ?? 0)
    );

    return maxCallIn;
  }

  getPlayersWithCardsCount() {
    return Object.keys(this.#holeCards).length;
  }

  getSbSeat(): Seat {
    assert(this.#seats.length >= this.minSeats, "Not enough players");

    if (this.#seats.length === this.minSeats) {
      const [firstSeat] = <[Seat]>this.#seats;

      return firstSeat;
    }
    const [, secondSeat] = <[Seat, Seat]>this.#seats;

    return secondSeat;
  }

  getBbSeat(): Seat {
    assert(this.#seats.length >= this.minSeats, "Not enough players");

    if (this.#seats.length === this.minSeats) {
      const [, secondSeat] = <[Seat, Seat]>this.#seats;

      return secondSeat;
    }

    const [, , thirdSeat] = <[Seat, Seat, Seat]>this.#seats;

    return thirdSeat;
  }

  getSeatByPlayerId(playerId: PlayerId) {
    return this.#seats.find((seat) => seat.playerId === playerId);
  }

  #moveBetsToPots() {
    let betsToProcess = Object.entries(this.#bets)
      .sort(([, amount1], [, amount2]) => amount1 - amount2)
      .filter(([, amount]) => amount > 0);

    while (betsToProcess.length) {
      const eligiblePlayers = new Set<PlayerId>(
        betsToProcess.map(([id]) => id).filter((id) => this.#holeCards[id])
      );

      const bet = betsToProcess[0]![1]!;
      const amount = betsToProcess.length * bet;

      const pot = this.#pots.find((pot) =>
        areSetsEqual(pot.eligiblePlayers, eligiblePlayers)
      );
      if (!pot) {
        this.#pots.push({
          potId: randomUUID(),
          amount,
          eligiblePlayers,
        });
      } else {
        pot.amount += amount;
      }

      [...betsToProcess.values()].forEach((pendingBet) => {
        pendingBet[1] -= bet;
      });
      betsToProcess = betsToProcess.filter(([, amount]) => amount > 0);
    }

    this.#bets = {};
  }

  async #preflop() {
    const { antes, smallBlind, bigBlind } = this.#gameConfig;
    const sbSeat = this.getSbSeat();
    const bbSeat = this.getBbSeat();

    this.#playerQueue = this.#seats.map(({ playerId }) => playerId);
    
    this.#makeBet(sbSeat.playerId, Math.min(smallBlind, sbSeat.stack));
    this.#makeBet(bbSeat.playerId, Math.min(bigBlind, bbSeat.stack));

    this.#minRaise = this.#gameConfig.bigBlind;

    for (const { playerId } of this.#seats) {
      this.#holeCards[playerId] = <[Card, Card]>this.#deal(2);
    }

    if (antes > 0) {
      this.#seats.forEach((seat) => {
        if (seat.playerId !== sbSeat.playerId && seat.playerId !== bbSeat.playerId) {
          this.#makeBet(seat.playerId, Math.min(antes, seat.stack));
        }
      });
    }

    await this.#sleep(1000);
  }

  async #showdown() {
    await this.#sleep(1000);

    await this.#giveWins();
    await this.#sleep(1000);
  }

  async #giveWins() {
    const playerCards = this.#seats
      .filter((seat) => this.#holeCards[seat.playerId])
      .map(
        (seat) =>
          ({
            playerId: seat.playerId,
            cards: CardGroup.fromString(
              this.#holeCards[seat.playerId]!.join("")
            ),
          } as {
            playerId: PlayerId;
            cards: [PokerToolsCard, PokerToolsCard];
          })
      );

    const communityCards = CardGroup.fromString(this.#communityCards.join(""));

    if (this.getPlayersWithCardsCount() === 1) {
      for (const pot of this.#pots) {
        const seat = this.#seats.find(
          (seat) => seat && this.#holeCards[seat.playerId]
        );
        if (!seat) {
          continue;
        }

        this.#givePots({
          playerIds: [seat.playerId],
          potId: pot.potId,
          winningCards: [],
        });

        seat.stack += pot.amount;
        await this.#sleep(1000);
      }
    } else {
      for (const pot of this.#pots) {
        const players = playerCards.filter((p) =>
          pot.eligiblePlayers.has(p.playerId)
        );

        if (players.length === 0) {
          continue;
        }

        const [winners] = OddsCalculator.calculateWinner(
          players.map((p) => p.cards),
          communityCards
        );

        const winnerIds = winners!.map((w) => players[w.index]!.playerId);

        const winningCards = new Set(
          winners!
            .map((w) => w.handrank.highcards.cards.map((c) => c.toString()))
            .flat()
        );

        this.#givePots({
          playerIds: winnerIds,
          potId: pot.potId,
          winningCards: [...winningCards.values()].sort(),
        });

        let extra = pot.amount % winnerIds.length;

        for (const playerId of winnerIds) {
          const seat = this.#seats.find((seat) => seat.playerId === playerId)!;
          seat.stack += Math.floor(pot.amount / winnerIds.length) + extra;
          extra = 0;
        }
        await this.#sleep(1000);
      }
    }
  }
}
