export const CARD_COLORS = ["RED", "BLUE", "GREEN", "YELLOW", "NEUTRAL"] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export const CARD_TYPES = ["LEGEND", "UNIT", "GEAR", "PROGRAM"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export type Card = {
  id: string;
  cardNumber: string;
  name: string;
  type: CardType;
  colors: CardColor[];
  rarity?: string;
  setCode: string;
  setName: string;
  cost?: number;
  power?: number;
  ram?: Partial<Record<CardColor, number>>;
  rulesText: string;
  flavorText?: string;
  tags: string[];
  keywords: string[];
  imageUrl?: string;
};
