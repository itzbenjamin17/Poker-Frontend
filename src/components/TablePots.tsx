import { Coins } from 'lucide-react';
import { LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED } from '../constants/strings';

interface TablePotsProps {
    displayedPot: number;
    mainPot: number;
    sidePots: number[];
    uncalledAmount: number;
    phase: string;
    isCompactTable: boolean;
    scale: number;
}

export function TablePots({
    displayedPot,
    mainPot,
    sidePots,
    uncalledAmount,
    phase,
    isCompactTable,
    scale,
}: TablePotsProps) {
    return (
        <>
            <div className="flex flex-col items-center gap-1 md:gap-2">
                <div aria-label="Total Pot" className="bg-black/40 px-3 md:px-6 py-2 rounded-full border border-white/5 backdrop-blur-md flex items-center gap-2 md:gap-3">
                    <Coins aria-hidden="true" className="w-3 h-3 md:w-4 md:h-4 text-gold-secondary" />
                    <span className="font-headline font-bold text-lg md:text-2xl tracking-tight text-white">
                        ${displayedPot.toLocaleString()}
                    </span>
                </div>
                <span className="text-[9px] md:text-[10px] text-emerald-primary/60 font-bold uppercase tracking-[0.2em] animate-in fade-in duration-500">
                    {phase.replace(/_/g, ' ')}
                </span>
            </div>

            {!isCompactTable && (
                <div className="flex flex-wrap items-center justify-center gap-2 px-4">
                    <div className="bg-black/35 px-3 py-1 rounded-full border border-white/10">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">{LABEL_MAIN_POT}</span>
                        <span className="ml-2 text-sm font-bold text-gold-secondary">${mainPot.toLocaleString()}</span>
                    </div>
                    {sidePots.map((amount, index) => (
                        <div key={`side-pot-${index}`} className="bg-black/35 px-3 py-1 rounded-full border border-emerald-primary/30">
                            <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">
                                {LABEL_SIDE_POT_PREFIX} {index + 1}
                            </span>
                            <span className="ml-2 text-sm font-bold text-emerald-primary">${amount.toLocaleString()}</span>
                        </div>
                    ))}
                    {uncalledAmount > 0 && (
                        <div className="bg-black/35 px-3 py-1 rounded-full border border-red-400/40">
                            <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">{LABEL_UNCALLED}</span>
                            <span className="ml-2 text-sm font-bold text-red-300">${uncalledAmount.toLocaleString()}</span>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
