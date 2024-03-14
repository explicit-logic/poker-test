declare module "poker-tools" {
  interface Card {
    toString(): string;
  }

  export const CardGroup: {
    fromString(str: string): Card[];
  };
  export const OddsCalculator: {
    calculateWinner: (
      players: [Card, Card][],
      board: Card[]
    ) => Array<
      Array<{ index: number; handrank: { highcards: { cards: Card[] } } }>
    >;
  };
}
