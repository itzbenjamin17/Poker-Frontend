import { useGameContext } from '../context/GameContext';
import { CommunityCardsArea } from './CommunityCardsArea';
import { Button } from './UI';
import { CardUI } from './GameUI';
import { Trophy } from 'lucide-react';
import {
    BTN_LEAVE_REVIEW,
    REVIEW_TITLE,
    REVIEW_FORFEIT_NOTE,
    REVIEW_FINAL_BOARD_LABEL
} from '../constants/strings';

interface GameReviewViewProps {
    onLeave: () => void;
}

export function GameReviewView({ onLeave }: GameReviewViewProps) {
    const { gameEndResult, gameState } = useGameContext();

    if (!gameEndResult) return null;

    const winnerName = gameEndResult.winnerName;
    const isForfeit = gameEndResult.isForfeit;
    const winnerChips = gameEndResult.winnerChips;
    const message = gameEndResult.message;

    return (
        <main
            aria-label="Game review"
            className="flex flex-col items-center justify-center min-h-screen w-full bg-neutral-950 text-white p-4 overflow-y-auto"
        >
            <div className="w-full max-w-4xl space-y-8 py-8">
                {/* Header */}
                <div className="text-center space-y-4">
                    <div className="flex justify-center">
                        <div className="bg-yellow-500/10 p-4 rounded-full border border-yellow-500/20">
                            <Trophy className="w-12 h-12 text-yellow-500" />
                        </div>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase italic">
                        {REVIEW_TITLE}
                    </h1>
                    <div className="space-y-2">
                        <p className="text-2xl md:text-3xl font-bold text-yellow-500">
                            {winnerName ? `${winnerName} wins!` : 'Game Over'}
                        </p>
                        {winnerChips !== undefined && (
                            <p className="text-xl text-neutral-400">
                                Collected {winnerChips} chips
                            </p>
                        )}
                        {isForfeit && (
                            <p className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
                                {REVIEW_FORFEIT_NOTE}
                            </p>
                        )}
                    </div>
                    <div className="max-w-md mx-auto p-4 bg-white/5 border border-white/10 rounded-lg">
                        <p className="text-neutral-300 italic">{message}</p>
                    </div>
                </div>

                {/* Final Board */}
                <div className="space-y-4">
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500 text-center">
                        {REVIEW_FINAL_BOARD_LABEL}
                    </h2>
                    <div className="flex justify-center">
                        <CommunityCardsArea
                            communityCards={gameState?.communityCards ?? []}
                            scale={1.2}
                        />
                    </div>
                </div>

                {/* Player Results List */}
                <div className="space-y-4">
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                        Final Standings
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(gameState?.players ?? []).map((player) => {
                            const isWinner = player.isWinner || player.name === winnerName;
                            return (
                                <div
                                    key={player.id}
                                    className={`flex flex-wrap items-center justify-between gap-y-3 gap-x-4 p-4 rounded-xl border ${
                                        isWinner
                                            ? 'bg-yellow-500/10 border-yellow-500/30'
                                            : 'bg-white/5 border-white/10'
                                    }`}
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-lg truncate">{player.name}</span>
                                                {isWinner && (
                                                    <span className="bg-yellow-500 text-neutral-950 text-[10px] font-black px-1.5 py-0.5 rounded leading-none uppercase tracking-tighter">
                                                        WINNER
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm text-neutral-400">
                                                {player.chips} chips
                                                {player.handRank && (
                                                    <span className="ml-2 text-yellow-500/70">
                                                        • {player.handRank}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Revealed Cards */}
                                    <div className="flex gap-1 shrink-0">
                                        {(player.holeCards ?? []).map((card, idx) => (
                                            <CardUI key={idx} card={card} scale={0.6} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Action */}
                <div className="flex justify-center pt-8">
                    <Button
                        onClick={onLeave}
                        variant="ghost"
                        className="w-full max-w-xs px-6 py-4 text-base md:w-auto md:max-w-none md:px-12 md:py-6 md:text-xl font-bold tracking-[0.2em] md:tracking-[0.3em] uppercase border-2 border-white/20 hover:bg-white hover:text-black transition-all"
                    >
                        {BTN_LEAVE_REVIEW}
                    </Button>
                </div>
            </div>
        </main>
    );
}
