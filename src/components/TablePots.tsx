import { Coins } from 'lucide-react';
import { useState } from 'react';
import { LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED } from '../constants/strings';

interface PotBreakdownProps {
    mainPot: number;
    sidePots: number[];
    uncalledAmount: number;
}

export function PotBreakdown({ mainPot, sidePots, uncalledAmount }: PotBreakdownProps) {
    return (
        <div role="region" aria-label="Pot breakdown" className="flex flex-wrap items-center justify-center gap-2 px-4">
            <div className="bg-black/35 px-3 py-1 rounded-full border border-white/10">
                <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">{LABEL_MAIN_POT}</span>
                <span className="ml-2 text-sm font-bold text-gold-secondary">${mainPot.toLocaleString()}</span>
            </div>
            {sidePots.map((amount, index) => (
                <div key={`side-pot-${index}`} className="bg-black/35 px-3 py-1 rounded-full border border-gold-secondary/30">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">
                        {LABEL_SIDE_POT_PREFIX} {index + 1}
                    </span>
                    <span className="ml-2 text-sm font-bold text-gold-secondary">${amount.toLocaleString()}</span>
                </div>
            ))}
            {uncalledAmount > 0 && (
                <div className="bg-black/35 px-3 py-1 rounded-full border border-gold-secondary/30">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">{LABEL_UNCALLED}</span>
                    <span className="ml-2 text-sm font-bold text-gold-secondary">${uncalledAmount.toLocaleString()}</span>
                </div>
            )}
        </div>
    );
}

export function CompactPotDetails({ mainPot, sidePots, uncalledAmount }: PotBreakdownProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="relative flex flex-col items-center gap-1">
            <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setIsOpen((showDetails) => !showDetails)}
                className="min-h-11 rounded-full border border-gold-secondary/30 bg-black/40 px-3 text-[10px] font-bold uppercase tracking-widest text-gold-secondary"
            >
                {isOpen ? 'Hide pot details' : 'Show pot details'}
            </button>
            {isOpen && (
                <div className="absolute top-full z-30 mt-1 rounded-xl border border-white/10 bg-surface-high/95 py-2 shadow-xl backdrop-blur-md">
                    <PotBreakdown mainPot={mainPot} sidePots={sidePots} uncalledAmount={uncalledAmount} />
                </div>
            )}
        </div>
    );
}

interface TablePotsProps extends PotBreakdownProps {
    displayedPot: number;
    phase: string;
}

export function TablePots({
    displayedPot,
    mainPot,
    sidePots,
    phase,
}: TablePotsProps) {
    const prominentPot = sidePots.length > 0 ? mainPot : displayedPot;
    const prominentPotLabel = sidePots.length > 0 ? LABEL_MAIN_POT : 'Total Pot';

    return (
        <>
            <div className="flex flex-col items-center gap-1 md:gap-2">
                <div aria-label={prominentPotLabel} className="bg-black/40 px-3 md:px-6 py-2 rounded-full border border-white/5 backdrop-blur-md flex items-center gap-2 md:gap-3">
                    <Coins aria-hidden="true" className="w-3 h-3 md:w-4 md:h-4 text-gold-secondary" />
                    <span className="font-headline font-bold text-lg md:text-2xl tracking-tight text-white">
                        ${prominentPot.toLocaleString()}
                    </span>
                </div>
                <span className="text-[9px] md:text-[10px] text-emerald-primary/60 font-bold uppercase tracking-[0.2em] animate-in fade-in duration-500">
                    {phase.replace(/_/g, ' ')}
                </span>
            </div>
        </>
    );
}
