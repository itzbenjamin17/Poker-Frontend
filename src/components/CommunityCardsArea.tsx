import { motion } from 'motion/react';
import { CardUI } from './GameUI';
import { CARD_PLACEHOLDER_TURN, CARD_PLACEHOLDER_RIVER } from '../constants/strings';

interface CommunityCardsAreaProps {
    communityCards: string[];
}

export function CommunityCardsArea({ communityCards }: CommunityCardsAreaProps) {
    return (
        <div className="flex gap-3">
            {communityCards.map((card, i) => (
                <motion.div key={i} initial={{ scale: 0, rotateY: 90 }} animate={{ scale: 1, rotateY: 0 }}>
                    <CardUI card={card} />
                </motion.div>
            ))}
            {Array.from({ length: 5 - communityCards.length }).map((_, i) => (
                <div key={i} className="w-12 h-16 border-2 border-white/5 rounded-md border-dashed flex items-center justify-center">
                    <span className="text-[8px] text-white/10 font-bold uppercase tracking-widest">
                        {i === 0 && communityCards.length === 3
                            ? CARD_PLACEHOLDER_TURN
                            : i === 1 && communityCards.length === 4
                                ? CARD_PLACEHOLDER_RIVER
                                : ''}
                    </span>
                </div>
            ))}
        </div>
    );
}
