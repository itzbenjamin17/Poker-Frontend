import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { CardUI, PlayerPod } from '../GameUI';
import type { Player } from '../../types';

describe('GameUI Adversarial & Stress Testing', () => {
    const baseMockPlayer: Player = {
        id: 'player-adv-1',
        name: 'Adversary',
        chips: 50000,
        status: 'ACTIVE',
        currentBet: 0,
        hasFolded: false,
        isReadyForNextHand: false,
    };

    describe('PlayerPod Geometry & Centering Alignment', () => {
        const requiredStates: Array<{
            name: string;
            player: Player;
            props: Partial<React.ComponentProps<typeof PlayerPod>>;
        }> = [
            {
                name: 'Base state (no bet, no rank, idle)',
                player: { ...baseMockPlayer },
                props: {},
            },
            {
                name: 'With small bet (50)',
                player: { ...baseMockPlayer, currentBet: 50 },
                props: {},
            },
            {
                name: 'With large bet (1,000,000)',
                player: { ...baseMockPlayer, currentBet: 1000000 },
                props: {},
            },
            {
                name: 'With hand rank (ROYAL FLUSH)',
                player: { ...baseMockPlayer },
                props: { handRank: 'ROYAL_FLUSH' },
            },
            {
                name: 'With hand rank (TWO PAIR)',
                player: { ...baseMockPlayer },
                props: { handRank: 'TWO_PAIR' },
            },
            {
                name: 'Disconnected with countdown timer (95 seconds)',
                player: { ...baseMockPlayer, status: 'DISCONNECTED' },
                props: { disconnectSecondsRemaining: 95 },
            },
            {
                name: 'Disconnected with zero timer',
                player: { ...baseMockPlayer, status: 'DISCONNECTED' },
                props: { disconnectSecondsRemaining: 0 },
            },
            {
                name: 'Winner with crown',
                player: { ...baseMockPlayer },
                props: { isWinner: true },
            },
            {
                name: 'Ready status',
                player: { ...baseMockPlayer, isReadyForNextHand: true },
                props: {},
            },
            {
                name: 'Combined: Winner + Large Bet + Hand Rank + Ready + Big Blind',
                player: { ...baseMockPlayer, currentBet: 5000000, isReadyForNextHand: true },
                props: { isWinner: true, handRank: 'FOUR_OF_A_KIND', blindLabel: 'BB' },
            },
            {
                name: 'Active Turn (isCurrent = true) + Small Blind',
                player: { ...baseMockPlayer, currentBet: 100 },
                props: { isCurrent: true, blindLabel: 'SB' },
            },
            {
                name: 'Folded player with chips and previous bet',
                player: { ...baseMockPlayer, status: 'FOLDED', hasFolded: true, currentBet: 200 },
                props: {},
            },
        ];

        requiredStates.forEach(({ name, player, props }) => {
            test(`Geometry alignment invariant in state: ${name}`, () => {
                const { unmount } = render(
                    <PlayerPod player={player} size="md" scale={1} {...props} />
                );

                const podEl = screen.getByTestId('player-pod');
                const avatarEl = screen.getByTestId('player-avatar');

                // 1. Root pod bounding box dimensions match diameter exactly
                expect(podEl).toHaveStyle({ width: '80px', height: '80px' });

                // 2. Avatar is direct child of pod
                expect(avatarEl.parentElement).toBe(podEl);

                // 3. Avatar fills pod
                expect(avatarEl).toBeInTheDocument();

                // 4. Verify any extra child of player-pod is the seat details positioned outside normal flow
                const children = Array.from(podEl.children);
                expect(children[0]).toBe(avatarEl);

                if (children.length > 1) {
                    for (let i = 1; i < children.length; i++) {
                        const child = children[i] as HTMLElement;
                        expect(child).toHaveAttribute('data-testid', 'seat-details');
                        expect(child.className).toContain('absolute');
                    }
                }

                unmount();
            });
        });

        test('Sizes xs (48px), sm (64px), md (80px) and scale factors maintain strict geometry', () => {
            const sizeConfigs: Array<{ size: 'xs' | 'sm' | 'md'; scale: number; expected: string }> = [
                { size: 'xs', scale: 1, expected: '48px' },
                { size: 'sm', scale: 1, expected: '64px' },
                { size: 'md', scale: 1, expected: '80px' },
                { size: 'xs', scale: 1.5, expected: '72px' },
                { size: 'sm', scale: 0.8, expected: '51.2px' },
                { size: 'md', scale: 1.25, expected: '100px' },
                { size: 'md', scale: 2.0, expected: '160px' },
            ];

            sizeConfigs.forEach(({ size, scale, expected }) => {
                const { unmount } = render(
                    <PlayerPod
                        player={{ ...baseMockPlayer, currentBet: 999999 }}
                        handRank="STRAIGHT_FLUSH"
                        size={size}
                        scale={scale}
                    />
                );

                const podEl = screen.getByTestId('player-pod');
                expect(podEl).toHaveStyle({ width: expected, height: expected });
                unmount();
            });
        });

        test('Avatar badge elements (chips, crown, blinds, indicators) are absolutely positioned', () => {
            render(
                <PlayerPod
                    player={{ ...baseMockPlayer, chips: 1234567, status: 'DISCONNECTED' }}
                    isWinner={true}
                    blindLabel="BB"
                    disconnectSecondsRemaining={30}
                    size="md"
                    scale={1}
                />
            );

            const avatarEl = screen.getByTestId('player-avatar');
            // Every child of player-avatar except the inner initials container is positioned absolute
            const avatarChildren = Array.from(avatarEl.children) as HTMLElement[];
            
            // The inner initials circle is normal flow w-full h-full
            expect(avatarChildren[0].className).toContain('w-full');
            expect(avatarChildren[0].className).toContain('h-full');

            // All other overlays (crown, blinds, chips, disconnected) must have absolute
            for (let i = 1; i < avatarChildren.length; i++) {
                expect(avatarChildren[i].className).toContain('absolute');
            }
        });
    });

    describe('CardUI Scaling, Dimensions & Robustness', () => {
        const sizes: Array<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg'];
        const scales = [0.1, 0.5, 0.6, 0.8, 1.0, 1.1, 1.2, 1.5, 2.0, 3.0];
        const multiplierMap = { sm: 0.8, md: 1.0, lg: 1.1 };

        sizes.forEach((size) => {
            scales.forEach((scale) => {
                test(`CardUI renders without errors and scales accurately (size=${size}, scale=${scale})`, () => {
                    const { unmount } = render(
                        <CardUI card="AH" size={size} scale={scale} />
                    );

                    const cardEl = screen.getByRole('img', { name: /ace of hearts/i });
                    const s = scale * multiplierMap[size];
                    const expectedW = `${Math.round(s * 48)}px`;
                    const expectedH = `${Math.round(s * 64)}px`;
                    const expectedBorderRadius = `${Math.round(s * 6)}px`;
                    const expectedPadding = `${Math.round(s * 4)}px`;

                    expect(cardEl).toHaveStyle({
                        width: expectedW,
                        height: expectedH,
                        borderRadius: expectedBorderRadius,
                        padding: expectedPadding,
                    });

                    // Card must have overflow-hidden to prevent inner content clipping escape
                    expect(cardEl.className).toContain('overflow-hidden');
                    expect(cardEl.className).toContain('shrink-0');

                    unmount();
                });
            });
        });

        test('CardUI renders all four suits and ranks correctly', () => {
            const suits = [
                { card: 'AH', expectedName: 'Ace of Hearts', symbol: '♥', color: 'text-red-500' },
                { card: 'KD', expectedName: 'King of Diamonds', symbol: '♦', color: 'text-red-500' },
                { card: 'QC', expectedName: 'Queen of Clubs', symbol: '♣', color: 'text-zinc-800' },
                { card: 'JS', expectedName: 'Jack of Spades', symbol: '♠', color: 'text-zinc-800' },
                { card: 'TS', expectedName: 'Ten of Spades', symbol: '♠', display: '10' },
                { card: '2H', expectedName: '2 of Hearts', symbol: '♥', display: '2' },
            ];

            suits.forEach(({ card, expectedName, symbol, color, display }) => {
                const { unmount } = render(<CardUI card={card} />);
                const cardEl = screen.getByRole('img', { name: new RegExp(expectedName, 'i') });
                expect(cardEl).toBeInTheDocument();
                expect(cardEl).toHaveTextContent(symbol);
                if (display) {
                    expect(cardEl).toHaveTextContent(display);
                }
                if (color) {
                    expect(cardEl.innerHTML).toContain(color);
                }
                unmount();
            });
        });

        test('CardUI hidden cards scale correctly across all semantic sizes', () => {
            sizes.forEach((size) => {
                const { unmount } = render(<CardUI card="hidden" hidden={true} size={size} scale={1.2} />);
                const cardEl = screen.getByLabelText('Hidden Card');
                const s = 1.2 * multiplierMap[size];
                expect(cardEl).toHaveStyle({
                    width: `${Math.round(s * 48)}px`,
                    height: `${Math.round(s * 64)}px`,
                });
                unmount();
            });
        });

        test('CardUI edge cases (empty string, unknown suit, unknown rank, malformed input)', () => {
            const edgeCases = [
                { card: '', labelMatch: /of Unknown/i },
                { card: '9X', labelMatch: /9 of Unknown/i },
                { card: 'ZZ', labelMatch: /Z of Unknown/i },
                { card: '10H', labelMatch: /10 of Hearts/i },
            ];

            edgeCases.forEach(({ card, labelMatch }) => {
                const { unmount } = render(<CardUI card={card} />);
                const cardEl = screen.getByRole('img', { name: labelMatch });
                expect(cardEl).toBeInTheDocument();
                unmount();
            });
        });
    });
});
