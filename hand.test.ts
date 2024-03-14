import { expect, test, vi, describe } from "vitest";
import { Hand, type HandInterface } from "./hand";
const player = (name: string, stack: number = 1000) => ({
  playerId: name,
  stack,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeHand = (
  s: ReturnType<typeof player>[],
  deck?: string | null,
  gameConfig = {
    smallBlind: 10,
    bigBlind: 20,
    antes: 0,
    timeLimit: 10,
  }
) => {
  const listener = vi.fn();
  const hand: HandInterface = new Hand(s, gameConfig, {
    sleep: () => Promise.resolve(null),
    ...(deck ? { makeDeck: () => deck.match(/.{1,2}/g)! } : {}),
    givePots: listener,
  });
  // hand.on(listener);
  hand.start();
  return tick().then(() => ({ hand, listener }));
};

const act = (
  hand: HandInterface,
  playerId: string,
  action: Parameters<Hand["act"]>[1]
) => {
  hand.act(playerId, action);
  return tick();
};

const allIn = async (hand: HandInterface, playerId: string) => {
  await act(hand, playerId, {
    type: "bet",
    amount: hand.getSeatByPlayerId(playerId)!.stack,
  });
};

const pots = (hand: HandInterface) => hand.getState().pots.map((p) => p.amount);

test("gets small and big blind from players", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);
  expect(hand.getState().bets).toEqual({ b: 10, c: 20 });
});

test("proceeds to flop if BB checks", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "fold" });
  expect(hand.getState().communityCards).toEqual([]);
  await act(hand, "c", { type: "bet", amount: 0 });
  expect(hand.getState().communityCards.length).toBe(3);
});

test("continues turn if BB raises", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "fold" });
  expect(hand.getState().communityCards).toEqual([]);
  await act(hand, "c", { type: "bet", amount: 20 });
  expect(hand.getState().communityCards.length).toBe(0);
});

test("checking through proceeds to flop", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);
  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "bet", amount: 10 });
  await act(hand, "c", { type: "bet", amount: 0 });
  expect(hand.getState().communityCards.length).toBe(3);
});

test("invalid raise", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 60 });

  expect(hand.isValidBet("b", 45)).toBe(false);
  expect(hand.isValidBet("b", 50)).toBe(true);
});

test("skipping SB due to all-in", async () => {
  const { hand } = await makeHand([player("a", 15), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 15 });
  await act(hand, "b", { type: "bet", amount: 5 });

  expect(hand.getState().bets).toEqual({ a: 15, b: 15, c: 20 });
});

test("pot-sized raises", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 60 });

  // call
  await act(hand, "b", { type: "bet", amount: 50 });

  // A raised from 20 (BB) to 60, so minimum raise is 60-20 = 40 over 60
  expect(hand.isValidBet("c", 79)).toBe(false);
  expect(hand.isValidBet("c", 80)).toBe(true);
});

test("re-raises", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 40 });
  await act(hand, "b", { type: "bet", amount: 70 });
  await act(hand, "c", { type: "bet", amount: 100 });
});

test("post-flop bet and raise", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "bet", amount: 10 });

  expect(hand.getState().communityCards.length).toBe(0);
  await act(hand, "c", { type: "bet", amount: 0 });

  expect(hand.getState().communityCards.length).toBe(3);
  await act(hand, "b", { type: "bet", amount: 0 });
  await act(hand, "c", { type: "bet", amount: 0 });

  // raise to 50
  await act(hand, "a", { type: "bet", amount: 30 });

  // raise to 100
  await act(hand, "b", { type: "bet", amount: 80 });

  // can't check
  expect(hand.isValidBet("c", 0)).toBe(false);

  // can call
  expect(hand.isValidBet("c", 80)).toBe(true);

  //can raise
  expect(hand.isValidBet("c", 129)).toBe(false);
  expect(hand.isValidBet("c", 130)).toBe(true);
});

test("can't raise after all checks", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 200 });
  await act(hand, "b", { type: "bet", amount: 190 });
  await act(hand, "c", { type: "bet", amount: 180 });

  expect(hand.getState().communityCards.length).toBe(3);
});

test("full round of checking after flop", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "bet", amount: 10 });
  await act(hand, "c", { type: "bet", amount: 0 });

  expect(hand.getState().communityCards.length).toBe(3);

  await act(hand, "b", { type: "bet", amount: 0 });
  await act(hand, "c", { type: "bet", amount: 0 });
  await act(hand, "a", { type: "bet", amount: 0 });

  expect(hand.getState().communityCards.length).toBe(4);
});

describe("all-ins", () => {
  test("basic all-in", async () => {
    const { hand } = await makeHand([
      player("a", 25),
      player("b"),
      player("c"),
    ]);
    await allIn(hand, "a");
    await act(hand, "b", { type: "bet", amount: 15 });
    expect(hand.getState().bets).toEqual({ a: 25, b: 25, c: 20 });
  });

  test("minimum raise after all-in", async () => {
    const { hand } = await makeHand([
      player("a"),
      player("b", 50),
      player("c"),
    ]);
    await act(hand, "a", { type: "bet", amount: 100 });
    await allIn(hand, "b");

    expect(hand.isValidBet("c", 79)).toBe(false);
    expect(hand.isValidBet("c", 159)).toBe(false);
    await act(hand, "c", { type: "bet", amount: 160 });

    expect(hand.getState().bets).toEqual({ a: 100, b: 50, c: 180 });
  });

  test("fold + all-in + call", async () => {
    const { hand, listener } = await makeHand([
      player("a"),
      player("b", 40),
      player("c"),
    ]);
    await act(hand, "a", { type: "fold" });
    await allIn(hand, "b");
    await act(hand, "c", { type: "bet", amount: 20 });
    await tick();
    // expect(listener).toHaveBeenCalledWith({ type: "HAND__HandCompleted" });
  });

  test("all-in #2", async () => {
    const { hand } = await makeHand([
      player("d", 25),
      player("e"),
      player("f"),
    ]);
    await allIn(hand, "d");

    // calling all-in
    expect(hand.isValidBet("e", 15)).toBe(true);

    // we still can raise to 45, because all-in 25 < 2 * BB
    expect(hand.isValidBet("e", 35)).toBe(true);
  });

  test("all-in #3", async () => {
    const { hand } = await makeHand([
      player("a", 25),
      player("b"),
      player("c"),
      player("d", 30),
      player("e", 50),
    ]);
    await allIn(hand, "d");
    await allIn(hand, "e");
    await act(hand, "a", { type: "fold" });

    // matching E all-in
    expect(hand.isValidBet("b", 40)).toBe(true);

    // we still can raise, but within normal rules
    expect(hand.isValidBet("b", 59)).toBe(false);
    expect(hand.isValidBet("b", 60)).toBe(true);

    await act(hand, "b", { type: "fold" });

    // matching E all-in
    expect(hand.isValidBet("c", 30)).toBe(true);

    // we still can raise, but within normal rules
    expect(hand.isValidBet("c", 49)).toBe(false);
    expect(hand.isValidBet("c", 50)).toBe(true);
  });

  test("multiple all-ins", async () => {
    const { hand } = await makeHand([
      player("a", 35),
      player("b", 50),
      player("c"),
    ]);

    await allIn(hand, "a");
    await allIn(hand, "b");

    expect(hand.isValidBet("c", 30)).toBe(true);
    expect(hand.isValidBet("c", 49)).toBe(false);
    expect(hand.isValidBet("c", 50)).toBe(true);
  });

  test("checking after all-in", async () => {
    const { hand } = await makeHand([
      player("a"),
      player("b", 50),
      player("c"),
    ]);

    await act(hand, "a", { type: "bet", amount: 100 });
    await allIn(hand, "b");

    expect(hand.isValidBet("c", 0)).toBe(false);
    expect(hand.isValidBet("c", 30)).toBe(true);
    expect(hand.isValidBet("c", 80)).toBe(true);
  });

  test("calling with insufficient funds", async () => {
    const { hand } = await makeHand([
      player("a"),
      player("b", 90),
      player("c"),
    ]);

    await act(hand, "a", { type: "bet", amount: 100 });
    await allIn(hand, "b");
    expect(hand.getState().bets).toEqual({ a: 100, b: 90, c: 20 });
  });

  test("simultaneous all-in", async () => {
    const { hand } = await makeHand([
      player("a", 40),
      player("b", 40),
      player("c"),
    ]);

    await allIn(hand, "a");
    await allIn(hand, "b");

    expect(hand.isValidBet("c", 20)).toBe(true);
  });
});

describe("side pots", () => {
  test("basic side pot", async () => {
    const { hand } = await makeHand([
      player("a", 40),
      player("b", 80),
      player("c"),
    ]);

    await allIn(hand, "a");

    // call
    await act(hand, "b", { type: "bet", amount: 30 });

    // raise 80
    await act(hand, "c", { type: "bet", amount: 60 });

    // call
    await allIn(hand, "b");
    await tick();
    await tick();

    expect(hand.getState().communityCards.length).toBe(5);
    expect(pots(hand)).toEqual([120, 80]);
  });

  test("multiple side pots", async () => {
    const { hand } = await makeHand([
      player("a", 30),
      player("b", 50),
      player("c"),
    ]);

    await allIn(hand, "a");
    await allIn(hand, "b");
    await act(hand, "c", { type: "bet", amount: 30 });

    await tick();
    await tick();

    expect(hand.getState().communityCards.length).toBe(5);
    expect(pots(hand)).toEqual([90, 40]);
  });

  test("all-in with full pot and side pot", async () => {
    const { hand } = await makeHand([
      player("a", 75),
      player("b", 100),
      player("c"),
    ]);

    await act(hand, "a", { type: "bet", amount: 50 });

    // call
    await act(hand, "b", { type: "bet", amount: 40 });

    // call
    await act(hand, "c", { type: "bet", amount: 30 });

    // go to flop
    expect(hand.getState().communityCards.length).toBe(3);

    // check
    await act(hand, "b", { type: "bet", amount: 0 });

    // check
    await act(hand, "c", { type: "bet", amount: 0 });

    // still flop
    expect(hand.getState().communityCards.length).toBe(3);
    // raise
    await allIn(hand, "a");

    // still flop
    expect(hand.getState().communityCards.length).toBe(3);
    await allIn(hand, "b");

    // still flop
    expect(hand.getState().communityCards.length).toBe(3);
    // call
    await act(hand, "c", { type: "bet", amount: 50 });

    expect(pots(hand)).toEqual([225, 50]);
  });

  test("unequal all-ins", async () => {
    const { hand } = await makeHand([
      player("a", 25),
      player("b", 35),
      player("c"),
    ]);

    await allIn(hand, "a");
    await allIn(hand, "b");

    // call
    await act(hand, "c", { type: "bet", amount: 15 });

    expect(pots(hand)).toEqual([75, 20]);
  });

  test("four players, two side pots", async () => {
    const { hand } = await makeHand([
      player("a", 40),
      player("b", 70),
      player("c"),
      player("d"),
    ]);

    await act(hand, "d", { type: "bet", amount: 20 });
    await allIn(hand, "a");
    await allIn(hand, "b");

    // call 70
    await act(hand, "c", { type: "bet", amount: 50 });

    // raise 100
    await act(hand, "d", { type: "bet", amount: 80 });

    await act(hand, "c", { type: "bet", amount: 30 });

    // check!
    await act(hand, "c", { type: "bet", amount: 0 });

    expect(pots(hand)).toEqual([160, 90, 60]);
  });

  test("five players, three side pots", async () => {
    const { hand } = await makeHand([
      player("a", 25),
      player("b", 50),
      player("c", 75),
      player("d", 100),
      player("e"),
    ]);

    await act(hand, "d", { type: "bet", amount: 20 });
    await act(hand, "e", { type: "bet", amount: 20 });
    await allIn(hand, "a");
    await allIn(hand, "b");
    await allIn(hand, "c");

    await allIn(hand, "d");
    await act(hand, "e", { type: "bet", amount: 80 });

    expect(pots(hand)).toEqual([125, 100, 75, 50]);
  });

  test("four players, all-in turn and river", async () => {
    const { hand } = await makeHand([
      player("a", 50),
      player("b", 100),
      player("c", 100),
      player("d"),
    ]);

    await act(hand, "d", { type: "bet", amount: 20 });
    await act(hand, "a", { type: "bet", amount: 20 });
    await act(hand, "b", { type: "bet", amount: 10 });

    expect(hand.getState().communityCards.length).toBe(0);
    await act(hand, "c", { type: "bet", amount: 0 });
    expect(hand.getState().communityCards.length).toBe(3);

    await act(hand, "b", { type: "bet", amount: 0 });
    await act(hand, "c", { type: "bet", amount: 0 });
    await act(hand, "d", { type: "bet", amount: 0 });

    expect(hand.getState().communityCards.length).toBe(3);

    await act(hand, "a", { type: "bet", amount: 0 });
    expect(hand.getState().communityCards.length).toBe(4);

    await act(hand, "b", { type: "bet", amount: 0 });
    await act(hand, "c", { type: "bet", amount: 0 });
    await act(hand, "d", { type: "bet", amount: 0 });
    await allIn(hand, "a");

    // call all-in 50
    await act(hand, "b", { type: "bet", amount: 30 });

    await allIn(hand, "c");

    // call all-in 100
    await act(hand, "d", { type: "bet", amount: 80 });
    await allIn(hand, "b");
    expect(pots(hand)).toEqual([200, 150]);
    expect(hand.getState().communityCards.length).toBe(5);
  });

  test("six players, all-in chaos", async () => {
    const { hand } = await makeHand([
      player("a", 20),
      player("b", 35),
      player("c", 50),
      player("d", 70),
      player("e", 100),
      player("f"),
    ]);

    await allIn(hand, "d");
    await allIn(hand, "e");
    await act(hand, "f", { type: "bet", amount: 100 });
    await allIn(hand, "a");
    await allIn(hand, "b");
    await allIn(hand, "c");

    expect(pots(hand)).toEqual([120, 75, 60, 60, 60]);
  });
});

describe("winners", () => {
  test("tie", async () => {
    const { hand, listener } = await makeHand(
      [player("a", 20), player("b", 20), player("c", 20), player("d", 20)],
      ["7h7c", "7s7d", "AcKs", "2d3c", "8dJs6s2h4c"].join("")
    );

    await allIn(hand, "d");
    await allIn(hand, "a");
    await allIn(hand, "b");

    await tick();
    await tick();
    await tick();
    expect(listener).toHaveBeenCalledWith({
      playerIds: ["a", "b"],
      winningCards: ["6s", "7c", "7d", "7h", "7s", "8d", "Js"],
      potId: expect.any(String) as string,
    });
  });

  test("tie with extra chip", async () => {
    const { hand, listener } = await makeHand(
      [player("a", 25), player("b", 25), player("c", 25), player("d", 25)],
      ["7h7c", "7s7d", "AcKs", "2d3c", "8dJs6s2h4c"].join("")
    );

    await allIn(hand, "d");
    await allIn(hand, "a");
    await allIn(hand, "b");
    await act(hand, "c", { type: "fold" });
    await tick();
    await tick();
    await tick();
    expect(listener).toHaveBeenCalledWith({
      playerIds: ["a", "b"],
      winningCards: ["6s", "7c", "7d", "7h", "7s", "8d", "Js"],
      potId: expect.any(String) as string,
    });
    expect(hand.getSeatByPlayerId("a")!.stack).toBe(Math.ceil(95 / 2));
    expect(hand.getSeatByPlayerId("b")!.stack).toBe(Math.floor(95 / 2));
  });
});

describe("head-to-head", () => {
  test("head-to-head raise", async () => {
    const { hand } = await makeHand([player("a"), player("b")]);

    await act(hand, "a", { type: "bet", amount: 30 });
    await act(hand, "b", { type: "bet", amount: 20 });

    expect(hand.getState().communityCards.length).toBe(3);
  });
});

test("show cards on showdown", async () => {
  const { hand, listener } = await makeHand([
    player("a"),
    player("b"),
    player("c"),
  ]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "bet", amount: 10 });
  await act(hand, "c", { type: "bet", amount: 0 });

  // flop
  expect(hand.getState().communityCards.length).toBe(3);

  await act(hand, "b", { type: "bet", amount: 0 });
  await act(hand, "c", { type: "bet", amount: 0 });
  await act(hand, "a", { type: "bet", amount: 0 });

  // turn
  expect(hand.getState().communityCards.length).toBe(4);

  await act(hand, "b", { type: "bet", amount: 0 });
  await act(hand, "c", { type: "bet", amount: 0 });
  await act(hand, "a", { type: "bet", amount: 0 });

  // river
  expect(hand.getState().communityCards.length).toBe(5);

  await act(hand, "b", { type: "bet", amount: 0 });
  await act(hand, "c", { type: "bet", amount: 0 });

  expect(listener).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "ShowHoleCards" })
  );

  await act(hand, "a", { type: "bet", amount: 0 });

  // showdown
});

test("no weird side-pots", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 40 });
  await act(hand, "b", { type: "bet", amount: 30 });
  await act(hand, "c", { type: "bet", amount: 20 });

  // flop
  expect(hand.getState().communityCards.length).toBe(3);

  await act(hand, "b", { type: "fold" });
  await act(hand, "c", { type: "bet", amount: 20 });
  await act(hand, "a", { type: "bet", amount: 20 });

  // flop
  expect(hand.getState().communityCards.length).toBe(4);
  expect(hand.getState().pots.length).toBe(1);
});

test("respects blinds / antes", async () => {
  const SMALL_BLIND = 45;
  const BIG_BLIND = 50;
  const ANTES = 10;

  const { hand } = await makeHand(
    [player("a"), player("b"), player("c"), player("d")],
    null,
    {
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      antes: ANTES,
      timeLimit: 10,
    }
  );

  expect(hand.getState().bets).toEqual({
    b: SMALL_BLIND,
    c: BIG_BLIND,
    d: ANTES,
    a: ANTES,
  });
});

test("respects blinds / antes with all-ins", async () => {
  const SMALL_BLIND = 45;
  const BIG_BLIND = 50;
  const ANTES = 10;

  const { hand } = await makeHand(
    [player("a"), player("b"), player("c"), player("d", 5)],
    null,
    {
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      antes: ANTES,
      timeLimit: 10,
    }
  );

  expect(hand.getState().bets).toEqual({
    b: SMALL_BLIND,
    c: BIG_BLIND,
    d: 5,
    a: ANTES,
  });
});

test("correctly pays at fold", async () => {
  const { hand } = await makeHand([player("a"), player("b")]);

  await allIn(hand, "a");
  await act(hand, "b", { type: "fold" });
});

test("correctly handles huge raise", async () => {
  const { hand, listener } = await makeHand([
    player("a", 50000),
    player("b", 50000),
  ]);

  await act(hand, "a", { type: "bet", amount: 25000 });
  expect(hand.getState().minRaise).toBe(24990);
});
