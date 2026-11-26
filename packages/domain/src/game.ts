import { z } from "zod";
import { CardReferenceSchema } from "./card";
import { MatchIdSchema, PlayerIdSchema, RulesetIdSchema, RulesetVersionSchema, GameStateVersionSchema, GameEventSequenceSchema, CommandIdSchema, CardInstanceIdSchema, GigInstanceIdSchema } from "./identity";
import { AttackTargetSchema, ZoneRefSchema, EffectSchema, PendingChoiceSchema, PaymentSourceSchema } from "./mechanics";
export const OvertimeStateSchema = z.strictObject({ startedAfterTurn: z.number().int().min(2) });
export const OvertimeObservationSchema = z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("NORMAL"), qualifyingTurnStarts: z.number().int().min(0).max(2) }),
    z.strictObject({ status: z.literal("ACTIVE") })
]);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const DieTypeSchema = z.enum(["D4", "D6", "D8", "D10", "D12", "D20"]);
export const CardInstanceStateSchema = CardReferenceSchema.extend({
    id: CardInstanceIdSchema, ownerId: PlayerIdSchema, controllerId: PlayerIdSchema, zone: ZoneRefSchema,
    face: z.enum(["UP", "DOWN"]), readiness: z.enum(["READY", "SPENT"]), damage: z.number().int().nonnegative(),
    counters: z.record(z.string(), z.number().int()), statuses: z.array(z.enum(["GO_SOLO", "CANNOT_SELL", "LAG", "EFFECT_SOLD"])), attachments: z.array(CardInstanceIdSchema)
});
export const GigInstanceStateSchema = z.strictObject({
    id: GigInstanceIdSchema, ownerId: PlayerIdSchema, controllerId: PlayerIdSchema,
    location: z.strictObject({ playerId: PlayerIdSchema, zone: z.enum(["FIXER", "GIGS"]) }), dieType: DieTypeSchema,
    roll: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("UNROLLED") }), z.strictObject({ kind: z.literal("ROLLED"), initialValue: z.number().int().positive(), currentValue: z.number().int() })])
}).refine(g => g.roll.kind === "UNROLLED" || g.roll.initialValue <= Number(g.dieType.slice(1)), "Initial roll exceeds die faces");
export const PlayerStateSchema = z.strictObject({
    id: PlayerIdSchema, seat: z.number().int().nonnegative(), zones: z.strictObject({ DECK: z.array(CardInstanceIdSchema), HAND: z.array(CardInstanceIdSchema), BATTLEFIELD: z.array(CardInstanceIdSchema), TRASH: z.array(CardInstanceIdSchema), EDDIES: z.array(CardInstanceIdSchema), LEGENDS: z.array(CardInstanceIdSchema), REMOVED: z.array(CardInstanceIdSchema), RESOLVING_PROGRAM: z.array(CardInstanceIdSchema).optional() }),
    economy: z.strictObject({ sellsThisTurn: z.number().int().nonnegative(), callsThisTurn: z.number().int().nonnegative().optional(), usageTurn: z.number().int().nonnegative().optional() }),
    gigs: z.strictObject({ FIXER: z.array(GigInstanceIdSchema), GIGS: z.array(GigInstanceIdSchema) }), statuses: z.array(z.enum(["CANNOT_SELL"]))
});
export const CombatStateSchema = z.discriminatedUnion("stage", [
    z.strictObject({ stage: z.literal("NONE") }),
    z.strictObject({ stage: z.literal("ATTACK_TARGET_SELECTION"), attackerId: CardInstanceIdSchema, attackingPlayerId: PlayerIdSchema, target: z.null() }),
    z.strictObject({ stage: z.enum(["ATTACK_EFFECTS", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING", "GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION", "TRIGGER_RESOLUTION"]), attackerId: CardInstanceIdSchema, attackingPlayerId: PlayerIdSchema, target: AttackTargetSchema }),
    // Historical vocabulary only; no executable handler/admission for these later stages.
    z.strictObject({ stage: z.enum(["ATTACK_DECLARED", "TARGET_LOCKED", "COMBAT_RESOLUTION", "GIG_STEAL"]), attackerId: CardInstanceIdSchema, targetId: CardInstanceIdSchema.nullable(), blockerId: CardInstanceIdSchema.nullable() })
]);
export const TurnStepSchema = z.enum(["EDDIE_READY_SELECTION", "DISCARD_SELECTION", "TRIGGER_ORDER_SELECTION", "OPTIONAL_TRIGGER_SELECTION","GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION", "ATTACK_TARGET_SELECTION", "ATTACK_EFFECTS", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING", "GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION", "AMOUNT_SELECTION", "CARD_EFFECT", "TARGET_SELECTION", "CHOOSE_FIRST_PLAYER", "CUT_DECISION", "MULLIGAN_DECISION", "TURN_START", "READY", "DRAW", "CHOOSE_GIG", "ROLL_GIG", "MAIN", "PAYMENT_SELECTION", "CALL_EFFECT", "TURN_END", "FINISHED"]);
export const TimingStateSchema = z.strictObject({
    turn: z.number().int().nonnegative(), activePlayer: PlayerIdSchema, actingPlayer: PlayerIdSchema,
    emptyFixerStarts: z.number().int().nonnegative().optional(),
    step: TurnStepSchema.optional(), firstPlayer: PlayerIdSchema.optional(),
    window: z.enum(["EDDIE_READY_SELECTION", "DISCARD_SELECTION", "TRIGGER_ORDER_SELECTION", "OPTIONAL_TRIGGER_SELECTION","GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION", "SETUP", "MAIN", "CHOOSE_GIG", "PAYMENT_SELECTION", "TARGET_SELECTION", "AMOUNT_SELECTION", "ATTACK_TARGET_SELECTION", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING", "RESOLVING", "FINISHED"]), combat: CombatStateSchema
});
export const FightResultSchema = z.strictObject({ kind: z.literal("FIGHT_RESULT"), attackerId: CardInstanceIdSchema, defenderId: CardInstanceIdSchema,
        attackerPower: z.number().int(), defenderPower: z.number().int(), attackerComparisonPower: z.number().int().nonnegative(), defenderComparisonPower: z.number().int().nonnegative(),
        winnerId: CardInstanceIdSchema.nullable(), loserIds: z.array(CardInstanceIdSchema),
        // Batch V52 (11.4.1.4): a card effect decided the winner, superseding the power comparison.
        forcedWinnerId: CardInstanceIdSchema.optional() });
export type FightResult = DeepReadonly<z.infer<typeof FightResultSchema>>;
/** Registered future work, distinct from effects requiring resolution now. */
export const DelayedEffectSchema = z.strictObject({
    kind: z.literal("END_TURN_READY_EDDIES"), id: HashSchema, controllerId: PlayerIdSchema,
    sourceId: CardInstanceIdSchema, source: CardReferenceSchema, subjectId: CardInstanceIdSchema, subject: CardReferenceSchema,
    subjectTypesAtCreation: z.tuple([z.literal("LEGEND"), z.literal("UNIT")]).optional(),
    abilityId: z.string().min(1), createdTurn: z.number().int().positive(), originOrdinal: z.number().int().positive(), originEffectId: HashSchema
});
export type DelayedEffect = DeepReadonly<z.infer<typeof DelayedEffectSchema>>;
/** Batch V46: a registered "the next time a friendly Unit <fight outcome> this turn" effect of a resolved Program. */
export const FightOutcomeEffectSchema = z.strictObject({ kind: z.literal("NEXT_FIGHT_OUTCOME"), id: HashSchema, sourceId: CardInstanceIdSchema, source: CardReferenceSchema,
    abilityId: z.string().min(1), controllerId: PlayerIdSchema, createdTurn: z.number().int().positive(), expires: z.strictObject({ kind: z.literal("END_OF_TURN"), turn: z.number().int().positive() }) });
export type FightOutcomeEffect = DeepReadonly<z.infer<typeof FightOutcomeEffectSchema>>;
/** A fired registration: the friendly Unit whose fight outcome matched, and the opposing Unit of that fight. */
export const FightOutcomeSchema = z.strictObject({ effect: FightOutcomeEffectSchema, subjectId: CardInstanceIdSchema, opposingId: CardInstanceIdSchema });
export type FightOutcome = DeepReadonly<z.infer<typeof FightOutcomeSchema>>;
export const TriggerBindingSchema = z.strictObject({ sourceId: CardInstanceIdSchema, subjectId: CardInstanceIdSchema, controllerId: PlayerIdSchema,
    source: CardReferenceSchema, abilityId: z.string().min(1), delayedId: HashSchema.optional(), kind: z.enum(["DELAYED_END_TURN", "WHEN_FIGHT_WON", "WHEN_DEFEATED", "WHEN_PLAYED", "WHEN_ATTACKING", "WHEN_CARD_PLAYED", "WHEN_OWN_TURN_ENDS", "WHEN_UNIT_ATTACKS", "WHEN_BLOCKER_USED", "WHEN_GIG_STOLEN", "WHEN_FRIENDLY_UNIT_STEALS_GIG", "WHEN_UNIT_DEFEATED", "WHEN_FIGHT_LOST", "DELAYED_FIGHT_OUTCOME", "WHEN_SPENT", "WHEN_FRIENDLY_UNIT_USES_BLOCKER", "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS", "DELAYED_END_TURN_DEFEAT"]),
    // Batch V24 (10.16.3): a steal trigger is pending once per stolen Gig, so its binding names that Gig.
    gigInstanceId: GigInstanceIdSchema.optional(),
    // Batch V46: a fired next-fight-outcome binding names the opposing Unit of its fight.
    opposingId: CardInstanceIdSchema.optional(),
    // Batch V88: a Rival's adjust or swap binding names the effect that changed the Gig (one occurrence per effect, 6.4, 6.7).
    changeEffectId: z.string().min(1).optional() });
export type TriggerBinding = DeepReadonly<z.infer<typeof TriggerBindingSchema>>;
export const TriggerOriginSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("END_TURN"), playerId: PlayerIdSchema, turn: z.number().int().positive(), delayedEffects: z.array(DelayedEffectSchema).min(1).optional() }),
    z.strictObject({ kind: z.enum(["PLAY", "ATTACK", "BLOCK"]), subjectId: CardInstanceIdSchema }),
    // Batch V69 (3.7, 10.16.1): "when ... is spent" triggers of cards an action spent outside any other batch, resolved as the action ends.
    z.strictObject({ kind: z.literal("SPEND"), spentIds: z.array(CardInstanceIdSchema).min(1) }),
    // Batch V88: "When a Rival adjusts or swaps 1 or more friendly Gigs" triggers of a Rival's effect outside any other batch, resolved as
    // the action ends.
    z.strictObject({ kind: z.literal("GIG_CHANGE"), subjectIds: z.array(CardInstanceIdSchema).min(1) }),
    z.strictObject({ kind: z.literal("FIGHT"), result: FightResultSchema }),
    // Batch V24 (11.5.1.7): steal triggers become pending after every stolen Gig has moved.
    z.strictObject({ kind: z.literal("STEAL"), subjectId: CardInstanceIdSchema, gigInstanceIds: z.array(GigInstanceIdSchema).min(1) }),
    // Batch V46: after a fight, fired next-fight-outcome effects join the fight's DEFEATED triggers (11.4.2.2.1, 11.4.3); with
    // no defeat the batch holds them alone, so `defeated` is empty only with `fight`.
    z.strictObject({ kind: z.literal("DEFEAT"), effectSource: CardInstanceIdSchema.optional(), defeated: z.array(z.strictObject({ targetId: CardInstanceIdSchema, defeatedBy: CardInstanceIdSchema })),
        // Batch V51: a post-fight batch may carry only printed "loses a fight" triggers, so its fired outcomes may be empty.
        fight: z.strictObject({ result: FightResultSchema, outcomes: z.array(FightOutcomeSchema) }).optional() })
]);
export type TriggerOrigin = DeepReadonly<z.infer<typeof TriggerOriginSchema>>;
export const TriggerContinuationSchema = z.strictObject({
    // Batch V47: each Gig an effect stole in this batch; its steal triggers join the batch (11.5.1.7). Batch V48: one entry per steal.
    effectSteals: z.array(z.strictObject({ subjectId: CardInstanceIdSchema, gigInstanceIds: z.array(GigInstanceIdSchema).length(1) })).min(1).optional(),
    // Batch V48: each Unit an effect played in this batch; its {Play} triggers join the batch. `qualifyingOrdinal` is the
    // first-blue-play ordinal the play recorded, when it recorded one.
    effectPlays: z.array(z.strictObject({ subjectId: CardInstanceIdSchema, qualifyingOrdinal: z.number().int().positive().optional() })).min(1).optional(),
    // Batch V48: every effect defeat of this batch, in order (several sources may defeat inside one batch).
    effectDefeats: z.array(z.strictObject({ targetId: CardInstanceIdSchema, defeatedBy: CardInstanceIdSchema })).min(1).optional(), origin: TriggerOriginSchema, ordinal: z.number().int().positive(), bindings: z.array(TriggerBindingSchema).min(1),
    selectedEddieSlots: z.array(z.number().int().nonnegative()).length(1).optional(), resolvedIds: z.array(HashSchema), phase: z.enum(["SELECT", "OPTIONAL", "TARGET", "AMOUNT", "DISCARD", "READY", "PAYMENT"]), trashedIds: z.array(CardInstanceIdSchema).min(1).max(3).optional(), conditionMet: z.literal(true).optional(), targetGigId: GigInstanceIdSchema.optional(),
    // Batch V91: a paid trigger's sources chosen so far (phase PAYMENT), then the sources it spent while its Gig is chosen (phase TARGET).
    paymentSelected: z.array(PaymentSourceSchema).min(1).optional(), paid: z.array(PaymentSourceSchema).min(1).optional(),
    // Batch V87: the face-down Legend just looked at, while its free Call is offered.
    lookedLegendId: CardInstanceIdSchema.optional(),
    // Batch V29: the Legend already readied by a current "ready up to 2" choice.
    readiedLegends: z.array(CardInstanceIdSchema).length(1).optional(),
    // Batch V38: the Units already readied by a current "ready up to 3 friendly Units" choice.
    readiedUnits: z.array(CardInstanceIdSchema).min(1).max(2).optional(),
    // Batch V30: rival Units still to spend, one per friendly value-pair counted when the effect began.
    spendsRemaining: z.number().int().positive().optional(),
    // Batch V31: the card the first discard moved, while its "discards 1 more" is open.
    discardedCardId: CardInstanceIdSchema.optional(),
    // Batch V68: the Gear a free Gear play chose, while its host is chosen.
    selectedGearId: CardInstanceIdSchema.optional(),
    // Batch V69: cards spent before or during this batch whose "when spent" bindings it holds, in order.
    effectSpends: z.array(CardInstanceIdSchema).min(1).optional(),
    // Batch V88: observers of a Rival's adjust or swap made during this batch, whose bindings it holds, in order.
    effectGigChanges: z.array(CardInstanceIdSchema).min(1).optional(),
    // Batch V76: a played BRAINDANCE Program whose "When you play" bindings joined its own effect's DEFEAT batch.
    programPlay: CardInstanceIdSchema.optional(),
    // Batch V32: the Programs a current "you may discard N Programs" has discarded; complete before its bottom-deck pauses.
    discardedPrograms: z.array(CardInstanceIdSchema).min(1).max(2).optional() });
export const QualifyingAttackSummarySchema = z.strictObject({
    count: z.number().int().nonnegative(),
    first: z.strictObject({ attackerId: CardInstanceIdSchema, attacker: CardReferenceSchema }).nullable()
}).refine(h => (h.count === 0) === (h.first === null), "Zero attacks have no first occurrence; positive counts require one");
/** Batch V49: per player, the turn's first steal of a Gig with value less than the stealer's power, and the first such steal by a
 * different Unit; together they decide "the first time another friendly Unit steals ..." for any observer. */
export const BelowPowerStealSchema = z.strictObject({ stealerId: CardInstanceIdSchema, gigInstanceId: GigInstanceIdSchema });
export const EndTurnDefeatSchema = z.strictObject({ id: HashSchema, effectId: HashSchema, sourceId: CardInstanceIdSchema, source: CardReferenceSchema, abilityId: z.string().min(1),
    controllerId: PlayerIdSchema, subjectId: CardInstanceIdSchema, armed: z.boolean() });
export type EndTurnDefeat = z.infer<typeof EndTurnDefeatSchema>;
export const TurnHistorySchema = z.strictObject({
    belowPowerSteals: z.record(PlayerIdSchema, z.array(BelowPowerStealSchema).min(1).max(2)).optional(),
    // Batch V50: the turn's first defeated ARASAKA Unit (either player's), and the Units a free play let attack rival Units this turn.
    // Batch V52: fights each Unit won this turn, for "the first time this Unit wins a fight each turn".
    fightWins: z.record(CardInstanceIdSchema, z.number().int().positive()).optional(),
    // Batch V53: each player's first CYBERWARE Gear played this turn, for "your first CYBERWARE Gear each turn".
    firstCyberwareGearPlays: z.record(PlayerIdSchema, CardInstanceIdSchema).optional(),
    firstArasakaDefeat: CardInstanceIdSchema.optional(), rivalUnitAttackGrants: z.array(CardInstanceIdSchema).min(1).optional(),
    firstArasakaAttacks: z.record(PlayerIdSchema, QualifyingAttackSummarySchema).optional(), gigsStolenByUnit: z.record(CardInstanceIdSchema, z.number().int().positive()).optional(),
    // Batch V69: "when spent" bindings pending from a spend outside any trigger batch, until the action's next batch or its end.
    spendTriggers: z.array(TriggerBindingSchema).min(1).optional(),
    // Batch V88: "When a Rival adjusts or swaps" bindings pending from a change outside any trigger batch, until the action's next batch or end.
    gigChangeTriggers: z.array(TriggerBindingSchema).min(1).optional(),
    // Batch V90: "If that Unit steals or fights, defeat it at the end of this turn": one record per resolved effect, armed once its Unit
    // steals a Gig or fights; an armed record binds into the END_TURN batch. A Unit that leaves the field before then is a new object.
    endTurnDefeats: z.array(EndTurnDefeatSchema).min(1).optional(),
    // Batch V72: cards with a "the first time this Unit is spent each turn" trigger already spent this turn.
    firstSpends: z.array(CardInstanceIdSchema).min(1).optional(),
    // Batch V92: the Units defeated this turn while equipped, recorded before they moved.
    equippedDefeats: z.array(CardInstanceIdSchema).min(1).optional(),
    // Batch V84: a Legend Called for free by an effect, whose {Call} ability resolves once the action's trigger batches are done (Batch
    // V86: or its attack has ended); `started` while that ability resolves, which may be the non-active player's.
    queuedCall: z.strictObject({ playerId: PlayerIdSchema, legendId: CardInstanceIdSchema, started: z.literal(true).optional() }).optional(),
    // Batch V83: unused "a friendly Legend may use {Go Solo} for -2 €$ this turn" grants, by resolved effect, in grant order.
    goSoloDiscounts: z.array(HashSchema).min(1).optional(),
    // Batch V79: Units whose next attack this turn may target ready Units, by id; `inAttack` once that attack is declared, until it ends.
    readyUnitAttackGrants: z.array(z.strictObject({ unitId: CardInstanceIdSchema, inAttack: z.boolean() })).min(1).optional(), turn: z.number().int().positive(), triggeredBatches: z.number().int().nonnegative(), blueUnitOrGearPlays: z.record(PlayerIdSchema, z.number().int().nonnegative()), programPlays: z.record(PlayerIdSchema, z.number().int().nonnegative()).optional() });
export const PendingEffectSchema = z.strictObject({ id: z.string().min(1), controllerId: PlayerIdSchema, sourceId: CardInstanceIdSchema.nullable(), primitiveIndex: z.literal(1).optional(), effect: EffectSchema, trigger: TriggerBindingSchema.omit({ sourceId: true, controllerId: true }).extend({ turn: z.number().int().positive(), ordinal: z.number().int().positive() }).optional(), causedBySequence: z.number().int().nonnegative() });
export const ActionReturnContextSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("MAIN") }), z.strictObject({ kind: z.literal("RIVAL_REACT") })]);
export type ActionReturnContext = z.infer<typeof ActionReturnContextSchema>;
const TemporaryPowerBaseSchema = z.strictObject({ kind: z.literal("POWER"), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema, expires: z.strictObject({ kind: z.literal("END_OF_TURN"), turn: z.number().int().positive() }) });
// Older one-shot Program payloads remain byte-compatible; repeated triggered buffs need occurrence identity.
export const TemporaryPowerModifierSchema = z.discriminatedUnion("amount", [
    TemporaryPowerBaseSchema.extend({ amount: z.literal(-1) }),
    TemporaryPowerBaseSchema.extend({ amount: z.literal(2), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) }),
    TemporaryPowerBaseSchema.extend({ amount: z.literal(5), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) }),
    // Batch V44: a resolving Program's "-5 power this turn"; the primitive's effect id keeps each play apart.
    TemporaryPowerBaseSchema.extend({ amount: z.literal(-5), origin: z.strictObject({ effectId: HashSchema }) })
]).or(
    // Batch V28: "+2 power this turn for each friendly Gig with an even value", counted once at resolution; `scaled` keeps it apart from the fixed +2.
    TemporaryPowerBaseSchema.extend({ amount: z.number().int().positive().multipleOf(2), scaled: z.literal("FRIENDLY_EVEN_GIGS"), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) })
).or(
    // Batch V60: a Called Legend's chosen "Give a rival Unit -2 power this turn" or "Give a friendly Unit +2 power this turn".
    TemporaryPowerBaseSchema.extend({ amount: z.union([z.literal(-2), z.literal(2)]), scaled: z.literal("LEGEND_CALL"), origin: z.strictObject({ effectId: HashSchema }) })
).or(
    // Batch V41: "This Unit gains power equal to that card's cost this turn": the revealed card is named, so the amount is its printed cost.
    TemporaryPowerBaseSchema.extend({ amount: z.number().int().positive(), scaled: z.literal("REVEALED_CARD_COST"), revealedCardId: CardInstanceIdSchema, origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) })
).or(
    // Batch V49: "A rival Unit loses power equal to this Unit's power this turn": the source's power at resolution; `sequence`
    // keeps repeated activations in one turn apart.
    // Batch V54: "Give all rival Units -5 power this turn": one modifier per Unit from one resolving effect, kept apart by target.
    TemporaryPowerBaseSchema.extend({ amount: z.literal(-5), scaled: z.literal("ALL_RIVAL_UNITS"), origin: z.strictObject({ effectId: HashSchema }) })
).or(
    TemporaryPowerBaseSchema.extend({ amount: z.number().int().negative(), scaled: z.literal("SOURCE_POWER"), origin: z.strictObject({ effectId: HashSchema, sequence: z.number().int().nonnegative() }) })
).or(
    // Batch V74: the "+1 power this turn" a Legend's Blocker grant also gives with a friendly value-pair of Gigs.
    TemporaryPowerBaseSchema.extend({ amount: z.literal(1), scaled: z.literal("BLOCKER_GRANT_BONUS"), origin: z.strictObject({ effectId: HashSchema, sequence: z.number().int().nonnegative() }) })
).or(
    // Batch V75: "+1 power this turn for each of its equipped Gear", fixed at the count as it resolved.
    TemporaryPowerBaseSchema.extend({ amount: z.number().int().positive(), scaled: z.literal("PER_EQUIPPED_GEAR"), origin: z.strictObject({ effectId: HashSchema, sequence: z.number().int().nonnegative() }) })).or(
    // Batch V76: a Legend's "When you play a BRAINDANCE Program, give a friendly Unit +1 power this turn", one per trigger occurrence.
    TemporaryPowerBaseSchema.extend({ amount: z.literal(1), scaled: z.literal("PROGRAM_PLAY_TRIGGER"), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) })).or(
    // Batch V79: a played Program's "Give this Unit +3 power this turn" on the friendly Unit it chose.
    TemporaryPowerBaseSchema.extend({ amount: z.literal(3), scaled: z.literal("PROGRAM_UNIT_GRANT"), origin: z.strictObject({ effectId: HashSchema }) })).or(
    // Batch V91: an attacking Unit's paid "power equal to a friendly max Gig this turn", the chosen Gig's value as it resolved.
    TemporaryPowerBaseSchema.extend({ amount: z.number().int().positive(), scaled: z.literal("PAID_MAX_GIG"), origin: z.strictObject({ effectId: HashSchema }) })).or(
    // Batch V90: a played Program's "+3 power this turn for each of its equipped Gears" on any player's equipped Unit, fixed as it resolved.
    TemporaryPowerBaseSchema.extend({ amount: z.number().int().positive().multipleOf(3), scaled: z.literal("PROGRAM_PER_EQUIPPED_GEAR"), origin: z.strictObject({ effectId: HashSchema }) })).or(
    // Batch V80: the "+2 power this turn" a Legend's rival-Unit attack grant also gives a ROCKER Unit; `sequence` keeps activations apart.
    TemporaryPowerBaseSchema.extend({ amount: z.literal(2), scaled: z.literal("ROCKER_ATTACK_GRANT_BONUS"), origin: z.strictObject({ effectId: HashSchema, sequence: z.number().int().nonnegative() }) })
);
export type TemporaryPowerModifier = z.infer<typeof TemporaryPowerModifierSchema>;
/** Batch V20: a keyword granted "this turn" by a resolved PLAY occurrence; it tracks the target only while it stays on the field. */
export const TemporaryKeywordGrantSchema = z.strictObject({ kind: z.literal("KEYWORD"), keyword: z.literal("ADRENALINE"), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema,
    expires: z.strictObject({ kind: z.literal("END_OF_TURN"), turn: z.number().int().positive() }), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) }).or(
    // Batch V74: {Blocker} from a Legend's Quick activation; `sequence` keeps repeated activations in one turn apart.
    z.strictObject({ kind: z.literal("KEYWORD"), keyword: z.literal("BLOCKER"), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema,
        expires: z.strictObject({ kind: z.literal("END_OF_TURN"), turn: z.number().int().positive() }), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), sequence: z.number().int().nonnegative() }) }));
export type TemporaryKeywordGrant = z.infer<typeof TemporaryKeywordGrantSchema>;
/** Batch V21: a restriction on rival stealing from a resolved PLAY occurrence (11.5.1.3); it ends at the start of its controller's next turn (8.6.2.1), wherever its source goes. */
export const GigStealRestrictionSchema = z.strictObject({ kind: z.literal("GIG_STEAL_RESTRICTION"), actor: z.enum(["UNIT", "LEGEND"]), forbidden: z.enum(["VALUE_ABOVE_POWER", "VALUE_BELOW_POWER"]),
    sourceId: CardInstanceIdSchema, protectedPlayerId: PlayerIdSchema, createdTurn: z.number().int().positive(), origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }) });
export type GigStealRestriction = z.infer<typeof GigStealRestrictionSchema>;
/** Batch V22: a chosen rival Unit that can't ready (2.6) until the start of the locking player's next turn (8.6.2.1), or until it leaves the field.
 * A PLAY-trigger origin carries its trigger ordinal; a resolving Program's primitive does not. */
// Batch V57: "steals 1 fewer Gig this turn" on one rival field Unit, from one resolved Program effect.
export const StealReductionSchema = z.strictObject({ kind: z.literal("STEAL_REDUCTION"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, controllerId: PlayerIdSchema,
    amount: z.literal(1), createdTurn: z.number().int().positive(), origin: z.strictObject({ effectId: HashSchema }) });
export type StealReduction = z.infer<typeof StealReductionSchema>;
// Batch V58: "+1 power for each friendly face-up Legend while fighting rival Units this turn" on one friendly field Unit.
export const FightPowerGrantSchema = z.strictObject({ kind: z.literal("FIGHT_POWER_GRANT"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, controllerId: PlayerIdSchema,
    amount: z.literal(1), createdTurn: z.number().int().positive(), origin: z.strictObject({ effectId: HashSchema }) });
export type FightPowerGrant = z.infer<typeof FightPowerGrantSchema>;
// Batch V61: "can't be defeated in a fight this turn" on one friendly field Unit.
export const FightDefeatImmunitySchema = z.strictObject({ kind: z.literal("FIGHT_DEFEAT_IMMUNITY"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, controllerId: PlayerIdSchema,
    createdTurn: z.number().int().positive(), origin: z.strictObject({ effectId: HashSchema }) });
export type FightDefeatImmunity = z.infer<typeof FightDefeatImmunitySchema>;
export const ReadyLockSchema = z.strictObject({ kind: z.literal("READY_LOCK"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, lockingPlayerId: PlayerIdSchema, createdTurn: z.number().int().positive(),
    origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive().optional() }) });
export type ReadyLock = z.infer<typeof ReadyLockSchema>;
// Batch V83: "A Unit can't attack until your next turn": one resolved Program mode's lock on one face-up field Unit, either player's.
export const AttackLockSchema = z.strictObject({ kind: z.literal("ATTACK_LOCK"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, lockingPlayerId: PlayerIdSchema, createdTurn: z.number().int().positive(),
    origin: z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1) }) });
export type AttackLock = z.infer<typeof AttackLockSchema>;
// Batch V43: "A rival Unit must attack next turn if it can": the obligation of one resolved PLAY occurrence on one rival Unit.
export const MustAttackSchema = z.strictObject({ kind: z.literal("MUST_ATTACK"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, forcingPlayerId: PlayerIdSchema, createdTurn: z.number().int().positive(),
    // Batch V63: a Legend's {Spend} activation creates it too; its activation effect id names the occurrence.
    origin: z.union([z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), ordinal: z.number().int().positive() }), z.strictObject({ effectId: HashSchema, abilityId: z.string().min(1), activated: z.literal(true) })]) });
export type MustAttack = z.infer<typeof MustAttackSchema>;
export const FightPreventionSchema = z.strictObject({
    kind: z.literal("PREVENT_NEXT_RIVAL_FIGHT_DEFEAT"), id: HashSchema, sourceId: CardInstanceIdSchema, controllerId: PlayerIdSchema,
    createdTurn: z.number().int().positive(), expires: z.strictObject({ kind: z.literal("END_OF_TURN"), turn: z.number().int().positive() })
});
export type FightPrevention = z.infer<typeof FightPreventionSchema>;
export const DefeatInstructionSchema = z.strictObject({ targetId: CardInstanceIdSchema, defeatedBy: CardInstanceIdSchema });
export type DefeatInstruction = z.infer<typeof DefeatInstructionSchema>;
export const ResolutionStateSchema = z.strictObject({
    stage: z.enum(["DECISION", "RESOLVE_EFFECT", "STATE_BASED_CHECKS", "DISCOVER_TRIGGERS", "ORDER_TRIGGERS", "CHOICE", "UNSUPPORTED"]),
    // Batch V55: THEN is the "if you do" defeat's target choice; `then` marks that clause through its owner order.
    targetedDefeatContinuation: z.strictObject({ phase: z.enum(["TARGET", "SECOND", "EACH", "ORDER", "THEN"]), then: z.literal(true).optional() }).optional(),
    triggerContinuation: TriggerContinuationSchema.optional(),
    returnTo: ActionReturnContextSchema.optional(),
    // Batch V81: the Gig just rolled in from the fixer area, while its controller chooses whether to ignore the result and reroll it once.
    gigRerollContinuation: z.strictObject({ gigInstanceId: GigInstanceIdSchema }).optional(),
    gigStealContinuation: z.strictObject({ selected: z.array(GigInstanceIdSchema), remaining: z.number().int().positive() }).optional(),
    defeatContinuation: z.strictObject({ fightResult: FightResultSchema.optional(), fightOutcomes: z.array(FightOutcomeSchema).min(1).optional(), appliedPrevention: FightPreventionSchema.optional(), appliedPreventions: z.array(FightPreventionSchema).min(2).optional(), defeats: z.array(DefeatInstructionSchema).min(1), orders: z.array(z.strictObject({ targetId: CardInstanceIdSchema, cardIds: z.array(CardInstanceIdSchema) })) }).optional(),
    legendEntryContinuation: z.strictObject({ mode: z.enum(["GO_SOLO", "PLAY"]), actorId: PlayerIdSchema, sourceId: CardInstanceIdSchema, remainingCost: z.number().int().positive(), selectedSources: z.array(PaymentSourceSchema) }).optional(),
    playContinuation: z.strictObject({ kind: z.enum(["PLAY", "ACTIVATE"]), actorId: PlayerIdSchema, sourceId: CardInstanceIdSchema, abilityId: z.string().min(1).optional(), phase: z.enum(["PAYMENT", "EFFECT", "EQUIP", "MODE"]), remainingCost: z.number().int().nonnegative(), selectedSources: z.array(PaymentSourceSchema), effectIndex: z.number().int().nonnegative(), targetGigId: GigInstanceIdSchema.optional(),
        // Batch V14: the cards the current Program primitive trashed from the deck, in trash order.
        trashedIds: z.array(CardInstanceIdSchema).min(1).max(4).optional(), // Batch V93: up to 4.
        // Batch V15: the Unit the first clause bottom-decked, while its "if you do" clause awaits a choice.
        bottomDecked: CardInstanceIdSchema.optional(),
        // Batch V44: the one printed mode a modal Program's controller chose; absent while every mode resolves.
        chosenEffect: z.number().int().nonnegative().optional(),
        // Batch V78: the cards a hand reset discarded from both hands, in discard order (empty when both hands were), while each player
        // in turn chooses whether to draw.
        discardedIds: z.array(CardInstanceIdSchema).optional(),
        // Batch V79: the friendly Unit chosen for both effects, while a Rival chooses which one it gets.
        grantTargetId: CardInstanceIdSchema.optional(),
        // Batch V82: the Gear chosen to move off its Legend, while the unequipped friendly Unit is chosen.
        movedGearId: CardInstanceIdSchema.optional(),
        // Batch V92: the hand Gear chosen to play for free, while its host is chosen; then, once it is equipped, the played Gear whose
        // play batch follows the ability.
        handGearId: CardInstanceIdSchema.optional(), playedGearId: CardInstanceIdSchema.optional(),
        // Batch V93: the trashed Gear chosen, while its controller adds it to hand or chooses a host to play it on.
        trashedGearId: CardInstanceIdSchema.optional(),
        // Batch V94: the trash Program a Legend's ability chose to play (never at a decision), and a Program played from the trash, which
        // is bottom-decked after it resolves instead of going to the trash.
        trashProgramId: CardInstanceIdSchema.optional(), fromTrash: z.literal(true).optional(),
        // Batch V95: the revealed top card of the deck chosen to play for free, a Unit or Program (never at a decision; a Gear is equipped
        // at once), and a card played that way, which pays nothing.
        deckPlayId: CardInstanceIdSchema.optional(), freeFromDeck: z.literal(true).optional() }).optional(),
    searchContinuation: z.strictObject({ looked: z.array(CardInstanceIdSchema), selected: z.array(CardInstanceIdSchema) }).optional(),
    callContinuation: z.strictObject({ actorId: PlayerIdSchema, legendId: CardInstanceIdSchema, remainingCost: z.number().int().nonnegative(), selectedSources: z.array(PaymentSourceSchema) }).optional(),
    current: PendingEffectSchema.nullable(), pending: z.array(PendingEffectSchema), discovered: z.array(PendingEffectSchema), choice: PendingChoiceSchema.nullable()
});
export const RngStateSchema = z.strictObject({ algorithm: z.literal("SHA256_COUNTER_V1"), seed: z.string().min(1), counter: z.number().int().nonnegative() });
export const FirstPlayerRollPairSchema = z.tuple([z.number().int().min(1).max(20), z.number().int().min(1).max(20)]);
export const SetupStateSchema = z.strictObject({
    stage: z.enum(["FIRST_PLAYER", "MAIN_CUT", "LEGEND_CUT", "MULLIGAN"]),
    decidingSeat: z.number().int().min(0).max(1),
    completed: z.number().int().min(0).max(1)
});
/** Remembered identity, not permission to inspect again (5.7.4.3). Public marker follows the physical Legend (5.7.4.2). */
export const KnownHiddenLegendSchema = z.strictObject({ kind: z.literal("LOOKED_AT_LEGEND"), viewerId: PlayerIdSchema, cardInstanceId: CardInstanceIdSchema, content: CardReferenceSchema });
export const GameStateSchema = z.strictObject({
    privateKnowledge: z.array(KnownHiddenLegendSchema).min(1).optional(),
    setup: SetupStateSchema.optional(),
    firstPlayerRolls: z.array(FirstPlayerRollPairSchema).min(1).optional(),
    schemaVersion: z.literal(2),
    match: z.strictObject({ format: z.literal("DEMO_STARTER_V1").optional(), id: MatchIdSchema, version: GameStateVersionSchema, eventSequence: GameEventSequenceSchema,
        overtime: OvertimeStateSchema.optional(),
        outcome: z.strictObject({ winnerId: PlayerIdSchema, loserId: PlayerIdSchema, reason: z.enum(["EMPTY_DRAW", "START_TURN_GIGS", "OVERTIME_GIGS"]) }).optional(),
        rulesetId: RulesetIdSchema, rulesetVersion: RulesetVersionSchema, rulesetHash: HashSchema, contentManifestHash: HashSchema,
        engineVersion: z.string().min(1), engineArtifactHash: HashSchema, cards: z.array(CardReferenceSchema), playerOrder: z.array(PlayerIdSchema).min(1) }),
    timing: TimingStateSchema, players: z.record(PlayerIdSchema, PlayerStateSchema),
    objects: z.strictObject({ cards: z.record(CardInstanceIdSchema, CardInstanceStateSchema), gigs: z.record(GigInstanceIdSchema, GigInstanceStateSchema) }),
    delayedEffects: z.array(DelayedEffectSchema).min(1).optional(),
    turnHistory: TurnHistorySchema.optional(),
    fightPreventions: z.array(FightPreventionSchema).optional(),
    temporaryModifiers: z.array(TemporaryPowerModifierSchema).optional(),
    temporaryKeywords: z.array(TemporaryKeywordGrantSchema).min(1).optional(),
    gigStealRestrictions: z.array(GigStealRestrictionSchema).min(1).optional(),
    readyLocks: z.array(ReadyLockSchema).min(1).optional(),
    attackLocks: z.array(AttackLockSchema).min(1).optional(), // Batch V83.
    stealReductions: z.array(StealReductionSchema).min(1).optional(),
    fightPowerGrants: z.array(FightPowerGrantSchema).min(1).optional(),
    fightDefeatImmunities: z.array(FightDefeatImmunitySchema).min(1).optional(),
    mustAttack: z.array(MustAttackSchema).min(1).optional(),
    fightOutcomeEffects: z.array(FightOutcomeEffectSchema).min(1).optional(),
    resolution: ResolutionStateSchema, rng: RngStateSchema
});
export type DeepReadonly<T> = T extends string | number | boolean | null | undefined ? T : T extends object ? {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
export type GameState = DeepReadonly<z.infer<typeof GameStateSchema>>;
export type CardInstanceState = DeepReadonly<z.infer<typeof CardInstanceStateSchema>>;
export type GigInstanceState = DeepReadonly<z.infer<typeof GigInstanceStateSchema>>;
export type PendingEffect = DeepReadonly<z.infer<typeof PendingEffectSchema>>;
export const ActionPayloadSchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ACTIVATE_ABILITY"), sourceInstanceId: CardInstanceIdSchema, abilityId: z.string().min(1) }),
    z.strictObject({ kind: z.literal("SELL_CARD"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.enum(["PLAY_CARD", "CALL_LEGEND", "GO_SOLO", "DECLARE_ATTACK", "DECLARE_BLOCKER"]), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("ROLL_GIG"), gigInstanceId: GigInstanceIdSchema }),
    z.strictObject({ kind: z.literal("CHOOSE"), choiceId: z.string().min(1), optionIndices: z.array(z.number().int().nonnegative()) }),
    z.strictObject({ kind: z.literal("END_TURN") }),
    z.strictObject({ kind: z.literal("PASS_REACT") })
]);
export const GameActionSchema = z.strictObject({ actorId: PlayerIdSchema, action: ActionPayloadSchema });
export const GameCommandSchema = GameActionSchema.extend({ commandId: CommandIdSchema, idempotencyKey: z.string().min(1).max(200), expectedStateVersion: GameStateVersionSchema });
export const LegalActionSchema = GameActionSchema.extend({ actionId: HashSchema, descriptor: z.strictObject({ kind: z.enum(["ACTIVATE_ABILITY", "SELL_CARD", "ROLL_GIG", "CHOOSE", "PLAY_CARD", "CALL_LEGEND", "GO_SOLO", "DECLARE_ATTACK", "DECLARE_BLOCKER", "PASS_REACT", "END_TURN"]), label: z.string() }) });
export const ModelChoiceSchema = z.strictObject({ actionId: HashSchema });
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;
export type GameAction = z.infer<typeof GameActionSchema>;
export type GameCommand = z.infer<typeof GameCommandSchema>;
export type LegalAction = z.infer<typeof LegalActionSchema>;
export const EventPayloadSchema = z.discriminatedUnion("kind", [
    // Safe public fact: no hidden CardRef, name or physical instance identity.
    z.strictObject({ kind: z.literal("LEGEND_LOOKED_AT"), viewerId: PlayerIdSchema, legendSeat: z.number().int().nonnegative(), slot: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("TRIGGER_ORDER_SELECTED"), effectId: HashSchema, controllerId: PlayerIdSchema, forced: z.boolean() }),
    z.strictObject({ kind: z.literal("OPTIONAL_TRIGGER_ACCEPTED"), effectId: HashSchema, controllerId: PlayerIdSchema }),
    z.strictObject({ kind: z.literal("OPTIONAL_TRIGGER_DECLINED"), effectId: HashSchema, controllerId: PlayerIdSchema }),
    // Batch V77: a Rival's choice of where an effect's revealed cards go.
    z.strictObject({ kind: z.literal("DESTINATION_CHOSEN"), effectId: HashSchema, playerId: PlayerIdSchema, destination: z.enum(["HAND", "TRASH"]) }),
    // Batch V78: a player's choice whether to take an effect's optional draw.
    z.strictObject({ kind: z.literal("OPTIONAL_DRAW_CHOSEN"), effectId: HashSchema, playerId: PlayerIdSchema, draw: z.boolean() }),
    // Batch V79: "The next time this Unit attacks this turn, it may attack ready Units."
    z.strictObject({ kind: z.literal("GEAR_MOVED"), effectId: HashSchema, gearInstanceId: CardInstanceIdSchema, fromHostId: CardInstanceIdSchema, toHostId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GIG_REROLL_CHOSEN"), gigInstanceId: GigInstanceIdSchema, reroll: z.boolean() }),
    z.strictObject({ kind: z.literal("READY_UNIT_ATTACK_GRANTED"), effectId: HashSchema, targetId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("QUALIFYING_PLAY_RECORDED"), playerId: PlayerIdSchema, cardInstanceId: CardInstanceIdSchema, ordinal: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("FIGHT_PREVENTION_CREATED"), effect: FightPreventionSchema }),
    z.strictObject({ kind: z.literal("FIGHT_PREVENTION_CONSUMED"), effectId: HashSchema, sourceId: CardInstanceIdSchema, controllerId: PlayerIdSchema, attackerId: CardInstanceIdSchema, defenderId: CardInstanceIdSchema }),
    // Batch V89 (10.25): a mandatory replacement: `replacementId` (its Gear) is defeated instead of `cardInstanceId`.
    z.strictObject({ kind: z.literal("END_TURN_DEFEAT_REGISTERED"), record: EndTurnDefeatSchema }),
    z.strictObject({ kind: z.literal("END_TURN_DEFEAT_ARMED"), recordId: HashSchema, subjectId: CardInstanceIdSchema, by: z.enum(["FIGHT", "STEAL"]) }),
    z.strictObject({ kind: z.literal("DEFEAT_REPLACED"), cardInstanceId: CardInstanceIdSchema, replacementId: CardInstanceIdSchema, defeatedBy: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("FIGHT_DEFEAT_PREVENTED"), effectId: HashSchema, sourceId: CardInstanceIdSchema, cardInstanceId: CardInstanceIdSchema, defeatedBy: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("FIGHT_PREVENTION_EXPIRED"), effectId: HashSchema, sourceId: CardInstanceIdSchema, reason: z.literal("TURN_END") }),
    z.strictObject({ kind: z.literal("FIGHT_OUTCOME_EFFECT_CREATED"), effect: FightOutcomeEffectSchema }),
    z.strictObject({ kind: z.literal("FIGHT_OUTCOME_EFFECT_FIRED"), effectId: HashSchema, subjectId: CardInstanceIdSchema, opposingId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("FIGHT_OUTCOME_EFFECT_EXPIRED"), effectId: HashSchema, reason: z.literal("TURN_END") }),
    z.strictObject({ kind: z.literal("FIGHT_STARTED"), attackerId: CardInstanceIdSchema, defenderId: CardInstanceIdSchema }),
    FightResultSchema,
    z.strictObject({ kind: z.literal("DEFEAT_TARGET_SELECTED"), effectId: z.string().min(1), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema, controllerId: PlayerIdSchema, forced: z.boolean() }),
    z.strictObject({ kind: z.literal("CARD_DEFEATED"), cardInstanceId: CardInstanceIdSchema, defeatedBy: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("DEFEAT_TRASH_ORDER_SELECTED"), targetId: CardInstanceIdSchema, cardInstanceId: CardInstanceIdSchema, ownerId: PlayerIdSchema, forced: z.boolean() }),
    z.strictObject({ kind: z.literal("GIG_STEAL_STARTED"), attackerId: CardInstanceIdSchema, defendingPlayerId: PlayerIdSchema, power: z.number().int(), allowance: z.number().int().nonnegative(), count: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_STEAL_SELECTED"), gigInstanceId: GigInstanceIdSchema, attackerId: CardInstanceIdSchema, forced: z.boolean() }),
    z.strictObject({ kind: z.literal("GIG_STOLEN"), gigInstanceId: GigInstanceIdSchema, fromPlayer: PlayerIdSchema, toPlayer: PlayerIdSchema, currentValue: z.number().int(), attackerId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("POWER_MODIFIER_APPLIED"), modifier: TemporaryPowerModifierSchema }),
    z.strictObject({ kind: z.literal("KEYWORD_GRANTED"), grant: TemporaryKeywordGrantSchema }),
    z.strictObject({ kind: z.literal("GIG_STEAL_RESTRICTED"), restriction: GigStealRestrictionSchema }),
    z.strictObject({ kind: z.literal("GIG_STEAL_RESTRICTION_EXPIRED"), sourceId: CardInstanceIdSchema, protectedPlayerId: PlayerIdSchema, effectId: HashSchema }),
    z.strictObject({ kind: z.literal("READY_LOCKED"), lock: ReadyLockSchema }),
    z.strictObject({ kind: z.literal("ATTACK_LOCKED"), lock: AttackLockSchema }),
    z.strictObject({ kind: z.literal("ATTACK_LOCK_EXPIRED"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, effectId: HashSchema, reason: z.enum(["NEXT_TURN", "LEFT_FIELD"]) }),
    z.strictObject({ kind: z.literal("GO_SOLO_DISCOUNT_GRANTED"), effectId: HashSchema, playerId: PlayerIdSchema }),
    z.strictObject({ kind: z.literal("GO_SOLO_DISCOUNT_USED"), cardInstanceId: CardInstanceIdSchema, effectId: HashSchema }),
    z.strictObject({ kind: z.literal("READY_LOCK_EXPIRED"), targetId: CardInstanceIdSchema, sourceId: CardInstanceIdSchema, effectId: HashSchema, reason: z.enum(["NEXT_TURN", "LEFT_FIELD"]) }),
    z.strictObject({ kind: z.literal("GIGS_SWAPPED"), effectId: HashSchema, gigInstanceIds: z.tuple([GigInstanceIdSchema, GigInstanceIdSchema]) }),
    z.strictObject({ kind: z.literal("READY_PREVENTED"), cardInstanceId: CardInstanceIdSchema, effectIds: z.array(HashSchema).min(1) }),
    z.strictObject({ kind: z.literal("KEYWORD_GRANT_EXPIRED"), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema, effectId: HashSchema, reason: z.enum(["TURN_END", "LEFT_FIELD"]) }),
    z.strictObject({ kind: z.literal("POWER_MODIFIER_EXPIRED"), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema, reason: z.enum(["TURN_END", "HIDDEN_AREA"]), effectId: HashSchema.optional() }),
    z.strictObject({ kind: z.literal("BLOCKER_SPENT"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("BLOCKER_DECLARED"), cardInstanceId: CardInstanceIdSchema, previousTarget: AttackTargetSchema }),
    z.strictObject({ kind: z.literal("RIVAL_REACT_CLOSED"), defendingPlayerId: PlayerIdSchema, reason: z.literal("PASS_REACT") }),
    z.strictObject({ kind: z.literal("COMBAT_RESOLUTION_PENDING"), attackerId: CardInstanceIdSchema, target: AttackTargetSchema }),
    z.strictObject({ kind: z.literal("ATTACK_TARGET_SELECTED"), attackerId: CardInstanceIdSchema, target: AttackTargetSchema }),
    z.strictObject({ kind: z.literal("ATTACKER_SPENT"), attackerId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("ATTACK_DECLARED"), attackerId: CardInstanceIdSchema, attackingPlayerId: PlayerIdSchema, target: AttackTargetSchema }),
    z.strictObject({ kind: z.literal("RIVAL_REACT_OPENED"), defendingPlayerId: PlayerIdSchema }),
    z.strictObject({ kind: z.literal("ATTACK_ENDED"), attackerId: CardInstanceIdSchema, reason: z.enum(["ATTACKER_INVALID", "TARGET_INVALID", "COMPLETED"]) }),
    z.strictObject({ kind: z.literal("GEAR_ATTACHED"), gearInstanceId: CardInstanceIdSchema, hostInstanceId: CardInstanceIdSchema, reason: z.literal("PLAY_CARD") }),
    z.strictObject({ kind: z.literal("GEAR_DETACHED"), gearInstanceId: CardInstanceIdSchema, hostInstanceId: CardInstanceIdSchema, reason: z.enum(["HOST_LEFT_AREA", "GEAR_LEFT_AREA"]) }),
    z.strictObject({ kind: z.literal("GIG_TARGET_SELECTED"), effectId: z.string(), gigInstanceId: GigInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GO_SOLO_ACTIVATED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("CARD_PLAYED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("ABILITY_ACTIVATED"), sourceInstanceId: CardInstanceIdSchema, abilityId: z.string() }),
    z.strictObject({ kind: z.literal("CARD_TARGET_SELECTED"), effectId: z.string().min(1), sourceId: CardInstanceIdSchema, targetId: CardInstanceIdSchema, controllerId: PlayerIdSchema, forced: z.boolean() }),
    z.strictObject({ kind: z.literal("CARD_SPENT"), cardInstanceId: CardInstanceIdSchema,
        cause: z.strictObject({ kind: z.literal("EFFECT"), sourceId: CardInstanceIdSchema, effectId: z.string().min(1) }).optional() }),
    z.strictObject({ kind: z.literal("LAG_REMOVED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GIG_ADJUSTMENT_DECLINED"), gigInstanceId: GigInstanceIdSchema }),
    z.strictObject({ kind: z.literal("CONDITION_EVALUATED"), effectId: z.string(), met: z.boolean() }),
    z.strictObject({ kind: z.literal("FIXER_PREPARED"), playerId: PlayerIdSchema }),
    // Batch V43: a must-attack obligation is created, fulfilled by an attack declaration, or ends.
    z.strictObject({ kind: z.literal("MUST_ATTACK_CREATED"), obligation: MustAttackSchema }),
    z.strictObject({ kind: z.literal("MUST_ATTACK_ENDED"), targetId: CardInstanceIdSchema, effectId: HashSchema, reason: z.enum(["ATTACKED", "NEXT_TURN", "LEFT_FIELD"]) }),
    z.strictObject({ kind: z.literal("CARD_REVEALED"), cardInstanceId: CardInstanceIdSchema }),
    // Batch V42: the card type a player chose for an effect.
    z.strictObject({ kind: z.literal("CARD_TYPE_CHOSEN"), effectId: z.string().min(1), playerId: PlayerIdSchema, cardType: z.enum(["UNIT", "GEAR", "PROGRAM"]) }),
    // Batch V44: the printed mode (0-based, in printed order) a modal Program's controller chose.
    z.strictObject({ kind: z.literal("EFFECT_MODE_CHOSEN"), sourceId: CardInstanceIdSchema, playerId: PlayerIdSchema, effectIndex: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("SEARCH_REMAINDER_BOTTOMED"), playerId: PlayerIdSchema, order: z.array(CardInstanceIdSchema), rngCounter: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("FIRST_PLAYER_ROLLED"), round: z.number().int().positive(), rolls: FirstPlayerRollPairSchema, tied: z.boolean() }),
    z.strictObject({ kind: z.literal("FIRST_PLAYER_DETERMINED"), playerId: PlayerIdSchema, rngCounter: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("FIRST_PLAYER_CHOSEN"), playerId: PlayerIdSchema, chosenBy: PlayerIdSchema }),
    z.strictObject({ kind: z.literal("SETUP_SHUFFLED"), playerId: PlayerIdSchema, zone: z.enum(["DECK", "LEGENDS"]), order: z.array(CardInstanceIdSchema), rngCounter: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("SETUP_CUT"), playerId: PlayerIdSchema, ownerId: PlayerIdSchema, zone: z.enum(["DECK", "LEGENDS"]), position: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("MULLIGAN_DECLARED"), playerId: PlayerIdSchema, accepted: z.boolean() }),
    z.strictObject({ kind: z.literal("MULLIGAN_RESOLVED"), playerId: PlayerIdSchema }),
    z.strictObject({ kind: z.literal("SETUP_LEGEND_SPENT"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("GAME_SETUP_COMPLETED") }),
    z.strictObject({ kind: z.literal("TURN_STARTED"), playerId: PlayerIdSchema, turn: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("TURN_ENDED"), playerId: PlayerIdSchema, turn: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("PHASE_CHANGED"), step: TurnStepSchema }),
    z.strictObject({ kind: z.literal("DELAYED_EFFECT_CREATED"), delayedEffect: DelayedEffectSchema }),
    z.strictObject({ kind: z.literal("CARD_READIED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("LEGEND_CALLED"), cardInstanceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("EFFECT_PENDING"), effectId: z.string(), sourceId: CardInstanceIdSchema }),
    z.strictObject({ kind: z.literal("EFFECT_RESOLVED"), effectId: z.string() }),
    z.strictObject({ kind: z.literal("OVERTIME_STARTED"), turn: z.number().int().min(2) }),
    z.strictObject({ kind: z.literal("GAME_ENDED"), winnerId: PlayerIdSchema, loserId: PlayerIdSchema, reason: z.enum(["EMPTY_DRAW", "START_TURN_GIGS", "OVERTIME_GIGS"]) }),
    z.strictObject({ kind: z.literal("CARD_DISCARDED"), cardInstanceId: CardInstanceIdSchema, playerId: PlayerIdSchema, sourceId: CardInstanceIdSchema, effectId: HashSchema, forced: z.boolean() }),
    z.strictObject({ kind: z.literal("CARD_MOVED"), cardInstanceId: CardInstanceIdSchema, from: ZoneRefSchema, to: ZoneRefSchema }),
    z.strictObject({ kind: z.literal("CARD_SOLD"), cardInstanceId: CardInstanceIdSchema, value: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("PAYMENT_MADE"), sources: z.array(PaymentSourceSchema) }),
    z.strictObject({ kind: z.literal("GIG_DIE_ROLLED"), gigInstanceId: GigInstanceIdSchema, dieType: DieTypeSchema, rawValue: z.number().int().positive(), rngCounter: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("GIG_VALUE_CHANGED"), gigInstanceId: GigInstanceIdSchema, previous: z.number().int(), current: z.number().int() }),
    z.strictObject({ kind: z.literal("GIG_CONTROL_CHANGED"), gigInstanceId: GigInstanceIdSchema, previous: PlayerIdSchema, current: PlayerIdSchema })
]);
export const GameEventSchema = z.strictObject({ sequence: GameEventSequenceSchema, payload: EventPayloadSchema });
export type GameEvent = z.infer<typeof GameEventSchema>;
export const ReplayStateHashSchema = HashSchema.brand<"ReplayStateHash">();
export const ObservationHashSchema = HashSchema.brand<"ObservationHash">();
export const PositionHashSchema = HashSchema.brand<"PositionHash">();
export type ReplayStateHash = z.infer<typeof ReplayStateHashSchema>;
export type ObservationHash = z.infer<typeof ObservationHashSchema>;
export type PositionHash = z.infer<typeof PositionHashSchema>;
export type MatchState = GameState["match"];
export type TimingState = GameState["timing"];
export type PlayerState = DeepReadonly<z.infer<typeof PlayerStateSchema>>;
export type PlayerZoneState = PlayerState["zones"];
export type ResolutionState = GameState["resolution"];
export type RngState = GameState["rng"];
