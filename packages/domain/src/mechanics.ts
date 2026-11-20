import { z } from "zod";
import { CardInstanceIdSchema, GigInstanceIdSchema, PlayerIdSchema } from "./identity";
export const GameAreaSchema = z.enum(["DECK", "HAND", "BATTLEFIELD", "TRASH", "EDDIES", "LEGENDS", "REMOVED"]);
// Technical object location, explicitly NOT a game area or Removed from Play (4.14.2).
export const ZoneSchema = z.enum([...GameAreaSchema.options, "RESOLVING_PROGRAM"]);
export const ZoneRefSchema = z.strictObject({ playerId: PlayerIdSchema, zone: ZoneSchema });
export const KeywordSchema = z.enum(["GO_SOLO", "QUICK", "BLOCKER", "ADRENALINE"]);
export const TriggerSchema = z.enum(["WHEN_SOLD", "WHEN_CALLED", "WHEN_PLAYED", "WHEN_ATTACKING", "WHEN_DEFEATED", "WHEN_FIGHT_WON", "WHEN_CARD_PLAYED", "WHEN_OWN_TURN_ENDS", "WHEN_UNIT_ATTACKS", "WHEN_BLOCKER_USED", "WHEN_GIG_STOLEN", "WHEN_FRIENDLY_UNIT_STEALS_GIG"]);
export const EquipTargetSchema = z.strictObject({ kind: z.literal("FRIENDLY_UNIT_OR_FACE_UP_LEGEND") });
export const TargetRelationshipSchema = z.enum(["CONTROLLED", "RIVAL", "ANY"]);
export const TargetSelectorSchema = z.discriminatedUnion("kind", [
    EquipTargetSchema,
    z.strictObject({ kind: z.literal("SELF") }),
    z.strictObject({ kind: z.literal("CARDS"), zone: ZoneSchema, relation: TargetRelationshipSchema, keyword: KeywordSchema.optional() }),
    z.strictObject({ kind: z.literal("GIGS"), relation: TargetRelationshipSchema })
]);
export const NamedUnitConditionSchema = z.strictObject({ kind: z.literal("SUBJECT_IS_UNIT_NAMED"), identity: z.literal("V") });
export const ConditionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ALL_FRIENDLY_LEGENDS_FACE_UP") }),
    z.strictObject({ kind: z.literal("STREET_CRED_IS_EVEN") }),
    z.strictObject({ kind: z.literal("STREET_CRED_LESS_THAN_VALUE"), value: z.number().int().nonnegative() }),
    NamedUnitConditionSchema,
    z.strictObject({ kind: z.literal("SUBJECT_STOLE_GIG_THIS_TURN") }),
    z.strictObject({ kind: z.literal("STREET_CRED_DIFFERENCE_AT_LEAST"), minimum: z.literal(10) }),
    z.strictObject({ kind: z.literal("STREET_CRED_LESS_THAN_RIVAL") }),
    z.strictObject({ kind: z.literal("STREET_CRED_GREATER_THAN_RIVAL") }),
    z.strictObject({ kind: z.literal("SOURCE_POWER_AT_LEAST"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE_AT_LEAST"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_COUNT"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DISTINCT_GIG_DIE_TYPES"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DISTINCT_GIG_VALUES"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("STREET_CRED"), minimum: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE"), value: z.number().int() }),
    // The trigger subject is on the field and currently spent (batch V8).
    z.strictObject({ kind: z.literal("SUBJECT_IS_SPENT") }),
    // Batch V24: the trigger subject is on the field with at least one attached Gear ("if it's equipped").
    z.strictObject({ kind: z.literal("SUBJECT_IS_EQUIPPED") }),
    // Batch V27: "if you control 2 or more Gigs with 8+ value".
    z.strictObject({ kind: z.literal("GIG_COUNT_WITH_VALUE_AT_LEAST"), minimum: z.literal(8), count: z.literal(2) }),
    // Batch V29: "If you control a value-pair of Gigs" (6.6: 2 dice with the same value in the same Gig area).
    z.strictObject({ kind: z.literal("CONTROLS_VALUE_PAIR") }),
    // Batch V39: "If a Rival controls at least 2 more Gigs than you" (Gigs in each Gig area, counted live).
    z.strictObject({ kind: z.literal("RIVAL_CONTROLS_MORE_GIGS"), minimum: z.literal(2) })
]);
export const CombatRestrictionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("CANNOT_ATTACK") }),
    // 9.3.2.2/9.3.2.3: removes only the rival Gig area from this Unit's valid attack targets.
    z.strictObject({ kind: z.literal("CANNOT_ATTACK_GIG_AREA") }),
    // Batch V10: "This Unit can't attack unless you played a Program this turn."
    z.strictObject({ kind: z.literal("CANNOT_ATTACK_UNLESS_PROGRAM_PLAYED_THIS_TURN") }),
    z.strictObject({ kind: z.literal("CANNOT_BE_BLOCKED"), condition: z.strictObject({ kind: z.literal("STREET_CRED_LESS_THAN_RIVAL") }) })
]);
export type CombatRestriction = z.infer<typeof CombatRestrictionSchema>;
export const CostSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("EDDIES"), amount: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("DASH") }), z.strictObject({ kind: z.literal("NONE") })
]);
export const PaymentSourceSchema = z.strictObject({ kind: z.enum(["EDDIE", "LEGEND"]), cardInstanceId: CardInstanceIdSchema });
export const AttackTargetSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("CARD"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GIG_AREA"), playerId: PlayerIdSchema })
]);
export type AttackTarget = z.infer<typeof AttackTargetSchema>;
export const ChoiceOptionSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("EDDIE_SLOT"), slot: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("LEGEND_SLOT"), slot: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("ATTACK_TARGET"), target: AttackTargetSchema }),
    z.strictObject({ kind: z.literal("CARD"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GIG"), gigInstanceId: GigInstanceIdSchema }),
    z.strictObject({ kind: z.literal("MODE"), mode: z.string().min(1) }),
    z.strictObject({ kind: z.literal("AMOUNT"), amount: z.number().int() }),
    z.strictObject({ kind: z.literal("EFFECT"), effectId: z.string().min(1) }),
    z.strictObject({ kind: z.literal("PAYMENT"), source: PaymentSourceSchema }),
    z.strictObject({ kind: z.literal("CONFIRM"), confirmed: z.boolean() })
]);
export const PendingChoiceSchema = z.strictObject({
    id: z.string().min(1), actorId: PlayerIdSchema,
    kind: z.enum(["CARD", "TARGET", "MODE", "AMOUNT", "ORDER", "ROLL_GIG", "MODIFY_GIG", "STEAL_GIGS", "PAYMENT", "OPTIONAL", "DISCARD", "READY_EDDIE"]),
    options: z.array(ChoiceOptionSchema), min: z.number().int().nonnegative(), max: z.number().int().nonnegative(),
    ordered: z.boolean(), continuationId: z.string().min(1)
}).refine(c => c.min <= c.max && c.max <= c.options.length, "Invalid choice bounds");
export const DiscardCardsEffectSchema = z.strictObject({
    kind: z.literal("DISCARD_CARDS"), player: z.enum(["CONTROLLER", "RIVAL"]), count: z.literal(1),
    selection: z.literal("CHOSEN_BY_AFFECTED_PLAYER"),
    when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: ConditionSchema }).optional(),
    // Batch V31: "If the card's cost equals the value of a friendly Gig, that Rival discards 1 more."
    more: z.strictObject({ condition: z.strictObject({ kind: z.literal("DISCARDED_COST_EQUALS_FRIENDLY_GIG_VALUE") }), count: z.literal(1) }).optional()
});
export type DiscardCardsEffect = z.infer<typeof DiscardCardsEffectSchema>;
export const ReadyEddiesEffectSchema = z.strictObject({ kind: z.literal("READY_EDDIES"), player: z.literal("CONTROLLER"), count: z.union([z.literal(1), z.literal(2)]),
    when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: NamedUnitConditionSchema }).optional() });
export const RegisterEndTurnEffectSchema = z.strictObject({ kind: z.literal("REGISTER_END_TURN_EFFECT"),
    effect: ReadyEddiesEffectSchema.extend({ count: z.literal(2), when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: NamedUnitConditionSchema }) }) });
// costAtMost absent means any cost (batch V8); admission stays with the exact per-card gate.
export const SpendUnitTargetSchema = z.strictObject({ kind: z.literal("UNITS"), relation: TargetRelationshipSchema, costAtMost: z.literal(4).optional() });
export type SpendUnitTarget = z.infer<typeof SpendUnitTargetSchema>;
// Batch V22: "Spend a rival Unit. It can't ready until your next turn." locks the chosen Unit too.
export const SpendUnitEffectSchema = z.strictObject({ kind: z.literal("SPEND_UNIT"), target: SpendUnitTargetSchema, preventReady: z.literal("UNTIL_YOUR_NEXT_TURN").optional() });
// Batch V15: field Units to bottom-deck, by relation, optional readiness and "lowest-power" (every tied minimum).
export const BottomDeckTargetSchema = z.strictObject({ relation: z.enum(["RIVAL", "CONTROLLED"]), readiness: z.enum(["READY", "SPENT"]).optional(), lowestPower: z.literal(true).optional() });
export type BottomDeckTarget = z.infer<typeof BottomDeckTargetSchema>;
// Shared Unit-defeat filter (plan section 6, scope 3b). The grammar admits nothing by itself:
// every card using it is pinned literally by its execution gate (exact per-card check).
const DefeatPowerAtMostSchema = z.strictObject({ kind: z.literal("AT_MOST"), value: z.number().int().nonnegative() });
export const DefeatUnitTargetSchema = z.strictObject({ kind: z.literal("UNITS"), relation: TargetRelationshipSchema,
    power: z.discriminatedUnion("kind", [DefeatPowerAtMostSchema, z.strictObject({ kind: z.literal("CONTROLLED_GIG_VALUE"), dieType: z.literal("D20") }), z.strictObject({ kind: z.literal("ANY") }),
        // "with less power than a friendly Unit" (batch V16): below the highest current power among the controller's Units.
        z.strictObject({ kind: z.literal("LESS_THAN_FRIENDLY_UNIT") })]),
    // Only Units whose current readiness is SPENT are eligible.
    readiness: z.literal("SPENT").optional(),
    // "with cost 2 or less" (batch V31): the Unit's referenced cost, alongside the power bound.
    cost: z.strictObject({ kind: z.literal("AT_MOST"), value: z.literal(2) }).optional(),
    // "If <condition>, defeat ... with power N or less instead": replaces the AT_MOST bound while the condition holds.
    instead: z.strictObject({ condition: z.strictObject({ kind: z.literal("STREET_CRED_GREATER_THAN_RIVAL") }), power: DefeatPowerAtMostSchema }).optional(),
    // "Defeat all other Units" (batch V10): every eligible Unit except the effect source, with no target choice.
    all: z.literal("OTHER_THAN_SOURCE").optional(),
    // "You may defeat 2 instead if a Rival controls at least 2 Gigs more than you" (batch V12): an optional
    // second distinct target, offered at resolution only while the condition holds.
    second: z.strictObject({ condition: z.strictObject({ kind: z.literal("RIVAL_GIG_COUNT_LEAD_AT_LEAST"), minimum: z.literal(2) }) }).optional(),
    // "Each player defeats one of their Units" (batch V12): from the effect controller in turn order, each
    // player chooses one Unit they control; all chosen Units are defeated together.
    each: z.literal("PLAYER_CHOOSES_OWN").optional() });
export type DefeatUnitTarget = z.infer<typeof DefeatUnitTargetSchema>;
// Preserve the Unit selectors and historical effect discriminator. Vocabulary is not execution admission.
export const DefeatGearTargetSchema = z.strictObject({ kind: z.literal("GEAR"), relation: z.enum(["RIVAL", "ANY"]),
    // Batch V34: "defeat a Gear" has no power bound; any controller's Gear qualifies (relation ANY).
    power: z.strictObject({ kind: z.literal("AT_MOST"), value: z.literal(2) }).optional() });
export type DefeatGearTarget = z.infer<typeof DefeatGearTargetSchema>;
export const DefeatTargetSchema = z.discriminatedUnion("kind", [DefeatUnitTargetSchema, DefeatGearTargetSchema]);
export type DefeatTarget = z.infer<typeof DefeatTargetSchema>;
export const DefeatUnitEffectSchema = z.strictObject({ kind: z.literal("DEFEAT_UNIT"), target: DefeatTargetSchema,
    when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: z.strictObject({ kind: z.literal("STREET_CRED_GREATER_THAN_RIVAL") }) }).optional(),
    // Batch V34: "You may defeat a Gear": the controller may decline the target choice.
    optional: z.literal(true).optional(),
    // Batch V34: "If its cost equals the value of a friendly Gig, draw 1": checked after the defeated card has moved.
    draw: z.strictObject({ condition: z.strictObject({ kind: z.literal("DEFEATED_COST_EQUALS_FRIENDLY_GIG_VALUE") }), count: z.literal(1) }).optional() });
export const EffectSchema = z.discriminatedUnion("kind", [
    SpendUnitEffectSchema,
    // "Spend this Unit" (batch V8).
    z.strictObject({ kind: z.literal("SPEND_SOURCE") }),
    // "Ready this Unit" / "ready a friendly face-up Legend" (batch V8).
    z.strictObject({ kind: z.literal("READY_UNIT"), target: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("SOURCE") }), z.strictObject({ kind: z.literal("FRIENDLY_FACE_UP_LEGEND") }),
        // Batch V25: "ready another friendly Unit with power equal to the Gig's value" (the Gig the steal trigger names).
        z.strictObject({ kind: z.literal("ANOTHER_FRIENDLY_UNIT"), power: z.literal("EQUALS_STOLEN_GIG_VALUE") })]) }),
    // "Spend all rival Units" (batch V9).
    z.strictObject({ kind: z.literal("SPEND_ALL_UNITS"), relation: z.literal("RIVAL") }),
    // "Return this Unit to its owner's hand" (batch V9); 4.12: equipped Gear moves with it.
    z.strictObject({ kind: z.literal("RETURN_TO_HAND"), target: z.strictObject({ kind: z.literal("SOURCE") }) }),
    // "Add another Unit from your trash to your hand" (batch V13): one public trash Unit other than the
    // trigger subject, chosen by the ability's controller.
    z.strictObject({ kind: z.literal("RETURN_TRASH_UNIT_TO_HAND"), exclude: z.literal("SUBJECT") }),
    // "Trash 3. Add a Unit from among them to your hand." (batch V14): 11.10.2.1 trash the top card of
    // your deck 3 times, one at a time, then return one Unit among exactly those cards.
    z.strictObject({ kind: z.literal("TRASH_THEN_RETURN_UNIT"), count: z.literal(3) }),
    // "Bottom-deck a Rival's lowest-power Unit" / "Bottom-deck a ready friendly Unit. If you do, bottom-deck a
    // spent rival Unit." (batch V15): 11.15, the owner bottom-decks; `then` applies only after the first Unit was.
    z.strictObject({ kind: z.literal("BOTTOM_DECK_UNIT"), target: BottomDeckTargetSchema, then: BottomDeckTargetSchema.optional() }),
    DefeatUnitEffectSchema,
    ReadyEddiesEffectSchema,
    RegisterEndTurnEffectSchema,
    z.strictObject({ kind: z.literal("DECREASE_GIG_UP_TO"), target: z.strictObject({ kind: z.literal("GIGS"), relation: z.literal("ANY") }), maximum: z.literal(2) }),
    DiscardCardsEffectSchema,
    z.strictObject({ kind: z.literal("LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND") }),
    z.strictObject({ kind: z.literal("OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN"), maximum: z.literal(2), draw: z.literal(1) }),
    z.strictObject({ kind: z.literal("CREATE_NEXT_RIVAL_FIGHT_PREVENTION") }),
    z.strictObject({ kind: z.literal("POWER_UNTIL_END_OF_TURN"), target: z.strictObject({ kind: z.enum(["RIVAL_UNIT", "SOURCE_SUBJECT", "FRIENDLY_UNIT"]) }), amount: z.number().int() }),
    // Batch V27: STOLEN_GIG is "increase it", the Gig a steal trigger names.
    z.strictObject({ kind: z.literal("ADJUST_GIG_UP_TO"), target: z.union([z.strictObject({ kind: z.literal("GIGS"), relation: z.literal("ANY") }), z.strictObject({ kind: z.literal("STOLEN_GIG") })]), maximum: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), direction: z.enum(["INCREASE", "DECREASE"]).optional() }),
    z.strictObject({ kind: z.literal("CONDITIONAL_DRAW"), timing: z.literal("RESOLUTION"), condition: ConditionSchema, count: z.number().int().positive() }),
    // Batch V19: an absent maxCost is "a Gear" with no cost limit.
    // Batch V35: "Search the top 4 cards of your deck. Reveal any number of cards with cost equal to any friendly Gig values and add
    // them to your hand. Bottom-deck the rest."
    z.strictObject({ kind: z.literal("SEARCH_COST_MATCHING_GIGS"), count: z.literal(4) }),
    // Batch V36: "Search the top 3 cards of your deck. Add 1 to your hand. You may add 1 more for each friendly min Gig. Bottom-deck the rest."
    z.strictObject({ kind: z.literal("SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG"), count: z.literal(3) }),
    // Batch V37: "You may set a Gig's value to the value of another Gig." (6.5: either player's Gigs, within the die's faces.)
    z.strictObject({ kind: z.literal("SET_GIG_TO_ANOTHER_GIG_VALUE"), optional: z.literal(true) }),
    z.strictObject({ kind: z.literal("SEARCH_GEAR"), count: z.number().int().positive().max(5), maxCost: z.number().int().nonnegative().optional(), maxTake: z.number().int().positive().max(2) }),
    // Batch V20: "[Play] Trash 3. Add a Program from among them to your hand."
    z.strictObject({ kind: z.literal("TRASH_THEN_RETURN_PROGRAM"), count: z.literal(3) }),
    // Batch V20: "[Play] Give another friendly Unit with cost 5 or less [Adrenaline] this turn."
    z.strictObject({ kind: z.literal("GRANT_KEYWORD_UNTIL_END_OF_TURN"), keyword: z.literal("ADRENALINE"), target: z.strictObject({ kind: z.literal("ANOTHER_FRIENDLY_UNIT"), costAtMost: z.literal(5) }) }),
    // Batch V21: "[Play] Until your next turn, rival Units can't steal friendly Gigs with value higher than their power" (and the Legend / less-than mirror).
    z.strictObject({ kind: z.literal("RESTRICT_RIVAL_GIG_STEAL"), actor: z.enum(["UNIT", "LEGEND"]), forbidden: z.enum(["VALUE_ABOVE_POWER", "VALUE_BELOW_POWER"]), duration: z.literal("UNTIL_YOUR_NEXT_TURN") }),
    // Batch V22: "[Play] If your Street Cred is an even number, a rival Unit can't ready until your next turn." (10.16.1.1: checked on resolution).
    // Batch V23: "You may swap a friendly Gig with a rival Gig." (6.7; a swap is not stealing, 6.7.2)
    z.strictObject({ kind: z.literal("SWAP_GIGS"), optional: z.literal(true) }),
    z.strictObject({ kind: z.literal("PREVENT_UNIT_READY"), target: SpendUnitTargetSchema, when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: z.strictObject({ kind: z.literal("STREET_CRED_IS_EVEN") }) }).optional(), duration: z.literal("UNTIL_YOUR_NEXT_TURN") }),
    // Batch V28: "+2 power this turn for each friendly Gig with an even value" / "Draw 1 for each friendly Gig with an odd value",
    // counted when the effect resolves.
    z.strictObject({ kind: z.literal("POWER_PER_FRIENDLY_GIG"), target: z.strictObject({ kind: z.literal("SOURCE_SUBJECT") }), amount: z.literal(2), parity: z.literal("EVEN") }),
    z.strictObject({ kind: z.literal("DRAW_PER_FRIENDLY_GIG"), count: z.literal(1), parity: z.literal("ODD") }),
    // Batch V30: "Spend a rival Unit for each friendly value-pair of Gigs" (6.6.1), counted when the effect resolves.
    z.strictObject({ kind: z.literal("SPEND_UNITS_PER_VALUE_PAIR"), target: z.strictObject({ kind: z.literal("UNITS"), relation: z.literal("RIVAL") }) }),
    // Batch V32: "You may discard 1 Program. If you do, bottom-deck a rival Unit." Own-hand Programs only; the bottom-deck
    // follows only after the discard (11.15: the owner bottom-decks the Unit and its Gear).
    // Batch V33: "You may discard 2 Programs. If you do, bottom-deck a rival unequipped Unit." (no attached Gear, 4.12).
    z.strictObject({ kind: z.literal("DISCARD_PROGRAMS_THEN_BOTTOM_DECK"), count: z.union([z.literal(1), z.literal(2)]), then: z.strictObject({ relation: z.literal("RIVAL"), unequipped: z.literal(true).optional() }) }),
    // Batch V40: "if its value is even, draw 1. If its value is odd, a Rival discards 1." One effect: the stolen Gig's parity is read
    // once, on resolution, so exactly one branch applies.
    z.strictObject({ kind: z.literal("STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD"), count: z.literal(1) }),
    // Batch V41: "Reveal the top card of your deck and add it to your hand. This Unit gains power equal to that card's cost this turn."
    z.strictObject({ kind: z.literal("REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST"), count: z.literal(1) }),
    // Batch V42: "choose a card type. Then, reveal the top card of your deck. If it's the chosen type, add it to your hand and ready 1
    // Eddie. Otherwise, trash it." The types are Unit, Gear and Program.
    z.strictObject({ kind: z.literal("CHOOSE_TYPE_REVEAL_TOP_ADD_AND_READY_EDDIE"), ready: z.literal(1) }),
    // Batch V38: "At the end of your turn, ready up to 3 friendly Units."
    z.strictObject({ kind: z.literal("READY_UNITS_UP_TO"), relation: z.literal("FRIENDLY"), maximum: z.literal(3) }),
    // Batch V29: "If you control a value-pair of Gigs, ready up to 2 MERC Legends in your Legends area."
    z.strictObject({ kind: z.literal("READY_LEGENDS_UP_TO"), tag: z.literal("Merc"), maximum: z.literal(2),
        when: z.strictObject({ timing: z.literal("RESOLUTION"), condition: z.strictObject({ kind: z.literal("CONTROLS_VALUE_PAIR") }) }) }),
    z.strictObject({ kind: z.literal("DRAW"), count: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("DAMAGE"), target: TargetSelectorSchema, amount: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("MOVE_CARD"), target: TargetSelectorSchema, destination: ZoneSchema }),
    z.strictObject({ kind: z.literal("MODIFY_POWER"), target: TargetSelectorSchema, amount: z.number().int() }),
    z.strictObject({ kind: z.literal("MODIFY_GIG_VALUE"), target: TargetSelectorSchema, amount: z.number().int() }),
    z.strictObject({ kind: z.literal("CREATE_CHOICE"), choice: PendingChoiceSchema }),
    // A named, versioned handwritten implementation; no arbitrary mutation parameters.
    z.strictObject({ kind: z.literal("CUSTOM"), handlerId: z.string().regex(/^[a-z][a-z0-9._-]+@\d+$/) })
]);
export const ActivationCostSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("SPEND_SOURCE") }),
    z.strictObject({ kind: z.literal("PAYMENT_COST"), cost: CostSchema })
]);
export const AbilitySchema = z.strictObject({ id: z.string().min(1), trigger: TriggerSchema.optional(),
    inherited: z.literal("EQUIPPED_HOST").optional(),
    // Batch V26: STOLEN_GIG_IS_D6 limits a friendly-steal trigger to stolen d6 dice ("When a friendly Unit steals a d6").
    // Batch V40: STEALER_IS_LEGEND limits it to a stealing friendly Legend ("When a friendly Legend steals a Gig").
    guard: z.enum(["FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN", "FIRST_FRIENDLY_ARASAKA_UNIT_ATTACK_PER_TURN", "STOLEN_GIG_IS_D6", "STEALER_IS_LEGEND"]).optional(),
    activation: z.strictObject({ timing: z.literal("MAIN"), conditionTiming: z.literal("ACTIVATION_AND_RESOLUTION"), costs: z.array(ActivationCostSchema) }).optional(),
    conditions: z.array(ConditionSchema), cost: CostSchema, effects: z.array(EffectSchema) });
export const ContinuousModifierSchema = z.discriminatedUnion("kind", [
    // Batch V30: "This Unit can attack rival Units the turn it's played" (11.3.1): while lagging, rival Units only.
    z.strictObject({ kind: z.literal("CAN_ATTACK_RIVAL_UNITS_WHILE_LAGGING") }),
    z.strictObject({ kind: z.literal("FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"), amount: z.literal(1) }),
    // Batch V38: "Other friendly Units have +2 power while attacking." A field Unit's live contribution, never to itself.
    z.strictObject({ kind: z.literal("OTHER_FRIENDLY_ATTACKING_UNIT_POWER"), amount: z.literal(2) }),
    z.strictObject({ kind: z.literal("GRANT_KEYWORD_TO_HOST"), keyword: z.literal("BLOCKER") }),
    // Batch V39: "If a Rival controls at least 2 more Gigs than you, this Unit has [Adrenaline]": a Gear's live conditional grant.
    z.strictObject({ kind: z.literal("GRANT_KEYWORD_TO_HOST_IF"), keyword: z.literal("ADRENALINE"), condition: z.strictObject({ kind: z.literal("RIVAL_CONTROLS_MORE_GIGS"), minimum: z.literal(2) }) }),
    // 2.6/11.3.1: prevents rival Units that entered the field this turn (lagging) from attacking.
    z.strictObject({ kind: z.literal("RIVAL_LAGGING_UNITS_CANNOT_ATTACK") }),
    z.strictObject({ kind: z.literal("GRANT_PRINTED_POWER_TO_HOST") }),
    z.strictObject({ kind: z.literal("POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN"), amount: z.number().int() }),
    // 3.11.1.2: changes the amount paid to play this card, never its cost value; floors at the printed minimum.
    z.strictObject({ kind: z.literal("SELF_PLAY_COST_REDUCTION"), per: z.enum(["FRIENDLY_GIG_VALUE_AT_LEAST_8", "FRIENDLY_TRASH_UNIT", "RIVAL_UNIT", "FRIENDLY_FACE_UP_LEGEND"]), amount: z.literal(1), minimum: z.literal(1) }),
    z.strictObject({ kind: z.literal("POWER"), target: TargetSelectorSchema, amount: z.number().int(), requiresFaceUp: z.boolean() }),
    z.strictObject({ kind: z.literal("KEYWORD"), target: TargetSelectorSchema, keyword: KeywordSchema, requiresFaceUp: z.boolean() })
]);
export type Keyword = z.infer<typeof KeywordSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type Ability = z.infer<typeof AbilitySchema>;
export type Cost = z.infer<typeof CostSchema>;
export type TargetSelector = z.infer<typeof TargetSelectorSchema>;
export type ContinuousModifier = z.infer<typeof ContinuousModifierSchema>;
export type PaymentSource = z.infer<typeof PaymentSourceSchema>;
export type PendingChoice = z.infer<typeof PendingChoiceSchema>;
