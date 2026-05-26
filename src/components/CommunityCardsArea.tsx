import { motion } from 'motion/react';
import { CardUI } from './GameUI';
import { CARD_PLACEHOLDER_TURN, CARD_PLACEHOLDER_RIVER } from '../constants/strings';

interface CommunityCardsAreaProps {
    communityCards: string[];
    scale: number;
}

export function CommunityCardsArea({ communityCards, scale }: CommunityCardsAreaProps) {
    return (
        <div className="flex gap-3" style={{ gap: `${scale * 12}px` }}>
            {communityCards.map((card) => (
                <motion.div key={card} initial={{ scale: 0, rotateY: 90 }} animate={{ scale: 1, rotateY: 0 }}>
                    <CardUI card={card} scale={scale} />
                </motion.div>
            ))}
            {Array.from({ length: 5 - communityCards.length }).map((_, i) => (
                <div
                    key={i}
                    className="border-2 border-white/5 rounded-md border-dashed flex items-center justify-center"
                    style={{
                        width: `${scale * 48}px`,
                        height: `${scale * 64}px`,
                        borderRadius: `${scale * 6}px`,
                    }}
                >
                    <span
                        className="text-white/10 font-bold uppercase tracking-widest text-center"
                        style={{ fontSize: `${scale * 8}px` }}
                    >
                        {i === 0 && communityCards.length === 3
                            ? CARD_PLACEHOLDER_TURN
                            : i === 0 && communityCards.length === 4
                                ? CARD_PLACEHOLDER_RIVER
                                : ''}
                    </span>
                </div>
            ))}
        </div>
    );
}
