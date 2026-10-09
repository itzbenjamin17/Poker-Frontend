import { useState } from 'react';
import { Coins, ChevronRight, ChevronLeft } from 'lucide-react';
import { LABEL_MAIN_POT, LABEL_SIDE_POT_PREFIX, LABEL_UNCALLED } from '../constants/strings';
import { fontPx } from '../lib/tableGeometry';

export interface TablePotsProps {
    displayedPot: number;
    mainPot: number;
    sidePots: number[];
    uncalledAmount: number;
    phase: string;
    /** Spacing / icon scale. */
    scale?: number;
    /** Font scale (defaults to scale); fonts never drop below 8px. */
    textScale?: number;
}

export function PotBreakdown({
    mainPot,
    sidePots,
    uncalledAmount,
}: {
    mainPot: number;
    sidePots: number[];
    uncalledAmount: number;
}) {
    return (
        <div role="region" aria-label="Pot Breakdown" className="flex flex-col gap-1">
            <div>
                <span>{LABEL_MAIN_POT}</span>
                <span>{mainPot.toLocaleString()}</span>
            </div>
            {sidePots.map((sp, i) => (
                <div key={i}>
                    <span>{`${LABEL_SIDE_POT_PREFIX} ${i + 1}`}</span>
                    <span>{sp.toLocaleString()}</span>
                </div>
            ))}
            {uncalledAmount > 0 && (
                <div>
                    <span>{LABEL_UNCALLED}</span>
                    <span>{uncalledAmount.toLocaleString()}</span>
                </div>
            )}
        </div>
    );
}

export function CompactPotDetails({
    mainPot,
    sidePots,
    uncalledAmount,
}: {
    mainPot: number;
    sidePots: number[];
    uncalledAmount: number;
}) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div>
            <button
                type="button"
                aria-expanded={expanded}
                aria-label={expanded ? 'hide pot details' : 'show pot details'}
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? 'Hide Details' : 'Show Details'}
            </button>
            {expanded && (
                <PotBreakdown mainPot={mainPot} sidePots={sidePots} uncalledAmount={uncalledAmount} />
            )}
        </div>
    );
}

export function TablePots({
    displayedPot,
    mainPot,
    sidePots,
    uncalledAmount,
    phase,
    scale = 1,
    textScale = scale,
}: TablePotsProps) {
    const [viewingSidePots, setViewingSidePots] = useState(false);
    const hasMultiplePots = sidePots.length > 0 || uncalledAmount > 0;
    
    // Base sizes that will be multiplied by scale
    const baseIconSize = 16;
    const baseFontSize = 24;
    const baseSmallFontSize = 10;
    const basePaddingX = 24;
    const basePaddingY = 8;
    const baseGap = 12;

    return (
        <div className="flex flex-col items-center" style={{ gap: `${scale * 8}px` }}>
            {/* Phase Label */}
            <span 
                data-testid="pot-phase"
                className="text-emerald-primary/60 font-bold uppercase tracking-[0.2em] animate-in fade-in duration-500"
                style={{ fontSize: `${fontPx(10, textScale)}px` }}
            >
                {phase.replace(/_/g, ' ')}
            </span>

            {/* Pots Cluster */}
            <div className="flex flex-wrap items-center justify-center transition-all duration-300" style={{ gap: `${scale * 6}px` }}>
                
                {!viewingSidePots ? (
                    <>
                        {/* Main/Displayed Pot */}
                        <div 
                            data-testid="table-pot"
                            aria-label={hasMultiplePots ? LABEL_MAIN_POT : 'Total Pot'} 
                            className="bg-black/40 rounded-full border border-white/5 backdrop-blur-md flex items-center"
                            style={{
                                padding: `${scale * basePaddingY}px ${scale * basePaddingX}px`,
                                gap: `${scale * baseGap}px`
                            }}
                        >
                            <Coins 
                                aria-hidden="true" 
                                className="text-gold-secondary" 
                                style={{ width: `${scale * baseIconSize}px`, height: `${scale * baseIconSize}px` }}
                            />
                            {hasMultiplePots && (
                                <span className="text-white/70 font-bold uppercase tracking-widest" style={{ fontSize: `${fontPx(baseSmallFontSize, textScale)}px` }}>
                                    {LABEL_MAIN_POT}
                                </span>
                            )}
                            <span 
                                className="font-headline font-bold tracking-tight text-white"
                                style={{ fontSize: `${fontPx(baseFontSize, textScale)}px` }}
                            >
                                {(hasMultiplePots ? mainPot : displayedPot).toLocaleString()}
                            </span>
                        </div>
                        
                        {/* Button to view side pots */}
                        {hasMultiplePots && (
                            <button
                                data-testid="side-pot-chip"
                                aria-expanded="false"
                                onClick={() => setViewingSidePots(true)}
                                className="bg-black/60 hover:bg-black/40 text-gold-secondary/80 hover:text-gold-secondary border border-gold-secondary/20 hover:border-gold-secondary/50 rounded-full flex items-center transition-colors"
                                style={{
                                    padding: `${scale * 6}px ${scale * 12}px`,
                                    gap: `${scale * 4}px`,
                                    fontSize: `${fontPx(10, textScale)}px`
                                }}
                            >
                                <span className="font-bold uppercase tracking-widest">
                                    {sidePots.length > 0 ? `+${sidePots.length} Side Pot${sidePots.length > 1 ? 's' : ''}` : 'View Uncalled'}
                                </span>
                                <span className="sr-only">{' show pot details'}</span>
                                <ChevronRight style={{ width: `${scale * 14}px`, height: `${scale * 14}px` }} />
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        {/* Button to view main pot */}
                        <button
                            aria-expanded="true"
                            onClick={() => setViewingSidePots(false)}
                            className="bg-black/60 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/30 rounded-full flex items-center transition-colors"
                            style={{
                                padding: `${scale * 6}px ${scale * 12}px`,
                                gap: `${scale * 4}px`,
                                fontSize: `${fontPx(10, textScale)}px`
                            }}
                        >
                            <ChevronLeft style={{ width: `${scale * 14}px`, height: `${scale * 14}px` }} />
                            <span className="font-bold uppercase tracking-widest">Main Pot</span>
                            <span className="sr-only">{' hide pot details'}</span>
                        </button>

                        {/* Side Pots */}
                        {sidePots.map((amount, index) => (
                            <div 
                                key={`side-pot-${index}`} 
                                className="bg-black/35 rounded-full border border-gold-secondary/30 backdrop-blur-md flex items-center animate-in fade-in zoom-in-95 duration-200"
                                style={{
                                    padding: `${scale * 6}px ${scale * 14}px`,
                                    gap: `${scale * 8}px`
                                }}
                            >
                                <span className="text-white/70 font-bold uppercase tracking-widest" style={{ fontSize: `${fontPx(9, textScale)}px` }}>
                                    {LABEL_SIDE_POT_PREFIX} {index + 1}
                                </span>
                                <span className="font-bold text-gold-secondary" style={{ fontSize: `${fontPx(14, textScale)}px` }}>
                                    {amount.toLocaleString()}
                                </span>
                            </div>
                        ))}

                        {/* Uncalled Amount */}
                        {uncalledAmount > 0 && (
                            <div 
                                className="bg-black/35 rounded-full border border-gold-secondary/30 backdrop-blur-md flex items-center animate-in fade-in zoom-in-95 duration-200"
                                style={{
                                    padding: `${scale * 6}px ${scale * 14}px`,
                                    gap: `${scale * 8}px`
                                }}
                            >
                                <span className="text-white/70 font-bold uppercase tracking-widest" style={{ fontSize: `${fontPx(9, textScale)}px` }}>
                                    {LABEL_UNCALLED}
                                </span>
                                <span className="font-bold text-gold-secondary" style={{ fontSize: `${fontPx(14, textScale)}px` }}>
                                    {uncalledAmount.toLocaleString()}
                                </span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
