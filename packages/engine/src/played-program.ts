type Card = { readonly zone: { readonly zone: string }; readonly face: string };
/** Audit fix (2026-11-26): a played Program's "this turn" records outlive the Program (rules 4.14, 10.23). It rests in the trash, or,
 * after a play from the trash (Batch V94) or a queued free play (Batch V97), at the bottom of its owner's deck (rule 11.15.3). */
export function playedProgramZone(card: Card) { return card.zone.zone === "TRASH" || card.zone.zone === "RESOLVING_PROGRAM" || card.zone.zone === "DECK"; }
/** A bottom-decked Program is hidden, but its record was made while it was public. */
export function playedProgramFaceOk(card: Card) { return card.face === "UP" || card.zone.zone === "DECK"; }
