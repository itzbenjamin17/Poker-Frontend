# Adaptive table-first game page

**Status:** accepted for planning

The game page will treat the live table as the primary experience and adapt supporting information around it rather than using a freely arranged dashboard. Eligible viewports are landscape-only and must preserve a compact-landscape hero seat, a central board cluster, a soft table rail, a persistent action/ready dock, and a round-result sequence that progresses from a collapsed summary to a snap-point detail sheet. This replaces arbitrary modal resizing because it preserves player control while keeping touch targets, hierarchy, and layout boundaries predictable on smaller screens.

## Experience model

- The live table is the primary surface. Supporting panels must yield space to it rather than compete with it.
- Portrait is unsupported by product policy. The design targets the existing minimum-size and landscape constraints; those constraints must be verified before implementation without broadening the supported viewport contract.
- The table uses three responsive tiers already present in the product vocabulary: compact landscape, standard, and wide. The compact tier changes density and disclosure, not the core game model.
- The table retains its oval identity through a soft rail and vignette. The rail becomes lighter as the eligible viewport becomes more constrained so it does not clip or dictate the playing area.

## Table hierarchy

- The **board cluster** is the center of gravity: prominent pot amount, phase, then community cards.
- Main pot remains prominent. Side-pot and uncalled details become secondary information on compact screens and may be revealed through the same details expansion pattern.
- The local player occupies a protected compact-landscape hero seat at bottom-center, with hole cards, stack, bet, status, and turn/winner feedback kept together above the action dock.
- Opponents remain spatially anchored around the table as compact markers. Tapping one expands that seat in place; only one opponent may be expanded at a time. There is no separate player-detail destination.

## Round transition sequence

1. **Active play:** show the board cluster, hero seat, compact opponent markers, and the action dock.
2. **Result:** show a collapsed round summary containing the winner, payout, hand strength, and a visible details expansion.
3. **Expanded result:** use a snap-point detail sheet with collapsed, expanded, and full-review states. The sheet has deliberate bounds, visible collapse/close controls, and no arbitrary freeform resizing.
4. **Ready:** collapse the result to a slim strip and transform the action dock into the ready dock. The ready dock is the only expanded lower surface and has one primary `READY` action.
5. **Next hand:** remove result-specific detail and return the lower zone to the action dock without changing the table's reserved geometry.

## Result detail contract

The full-review state is a result detail recap, not a new hand-history feature. It should contain:

- winner or tie outcome;
- payout and final pot/side-pot breakdown;
- winning hand/rank;
- community cards and any revealed hole cards;
- player outcomes and relevant final statuses.

It should not contain a complete betting timeline, unrelated analytics, or a second navigation flow.

## Interaction rules

- The collapsed summary expands through a visible 44px-or-larger control with text or a clear icon. Swiping may supplement it but must never be the only route.
- The snap points are semantic, not arbitrary: collapsed, expanded, and full review. Each state has a predictable exit path.
- The action dock is persistent. During the user's turn it shows legal actions; otherwise it shows a quiet turn-status strip instead of disappearing and changing the table geometry.
- Action hierarchy is contextual: `CHECK`/`CALL` is primary, `FOLD` is secondary, `BET`/`RAISE` progressively reveals amount controls, and `ALL IN` appears only when relevant.
- The ready dock shows countdown, ready count, compact player-readiness status, and one primary `READY` action.

## Visual and motion language

- Emerald/mint means active or positive state: current turn, ready, winner, confirmation.
- Gold means money and stakes: pot, payout, blinds, chip values. It is not a universal winner highlight.
- Amber means waiting or attention. Red is reserved for leaving or genuinely destructive actions.
- Important states are never conveyed by color alone; they also use text, iconography, shape, or placement.
- Winner feedback is static and calm: a mint check/badge and restrained outline. Active-turn feedback may use a small timer/ring but must not pulse the entire player pod.
- Transitions use transform/opacity, remain interruptible, stay within roughly 150–300ms for micro-interactions, and respect reduced-motion preferences.
- Full review may use a purposeful scrim; collapsed and ordinary expanded states should preserve table context rather than dimming the whole game unnecessarily.

## Non-goals

- No portrait game layout.
- No freely draggable or arbitrarily resizable result window.
- No simultaneous large result and ready dashboards.
- No shrunken desktop table that makes cards and player labels unreadable.
- No new betting-history or analytics product hidden inside the round result.
