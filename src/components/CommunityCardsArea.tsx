import { motion, useReducedMotion } from 'motion/react';
import { CardUI } from './GameUI';
import { fontPx, isCompactCardScale } from '../lib/tableGeometry';
import { CARD_PLACEHOLDER_TURN, CARD_PLACEHOLDER_RIVER } from '../constants/strings';

interface CommunityCardsAreaProps {
    communityCards: string[];
    scale: number;
}

export function CommunityCardsArea({ communityCards, scale }: CommunityCardsAreaProps) {
    const prefersReducedMotion = useReducedMotion();
    const compactCards = isCompactCardScale(scale);
    return (
        <div
            role="region"
            aria-label="Community cards"
            className="flex gap-3"
            style={{ gap: `${scale * 12}px` }}
        >
            {Array.from({ length: 5 }).map((_, i) => {
                const card = communityCards[i];
                return (
                    <div 
                        key={i} 
                        data-testid={card ? `board-card-${i}` : `board-slot-${i}`}
                        className="relative flex items-center justify-center" 
                        style={{ width: `${scale * 48}px`, height: `${scale * 64}px` }}
                    >
                        {card ? (
                            <motion.div initial={prefersReducedMotion ? false : { scale: 0, rotateY: 90 }} animate={{ scale: 1, rotateY: 0 }} className="absolute inset-0">
                                <CardUI card={card} scale={scale} compact={compactCards} />
                            </motion.div>
                        ) : (
                            <div
                                role="group"
                                aria-label={`Empty card slot ${i + 1}`}
                                data-slot-index={i}
                                className="absolute inset-0 border-2 border-white/5 rounded-md border-dashed flex items-center justify-center"
                                style={{ borderRadius: `${scale * 6}px` }}
                            >
                                <span
                                    className="text-white/10 font-bold uppercase tracking-widest text-center"
                                    style={{ fontSize: `${fontPx(8, scale)}px` }}
                                >
                                    {i === 3 && communityCards.length === 3
                                        ? CARD_PLACEHOLDER_TURN
                                        : i === 4 && communityCards.length === 4
                                            ? CARD_PLACEHOLDER_RIVER
                                            : ''}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
