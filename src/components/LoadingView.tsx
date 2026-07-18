import { Button } from './UI';

interface LoadingViewProps {
    status: string;
    onLeave?: () => void;
}

export function LoadingView({ status, onLeave }: LoadingViewProps) {
    const showLeaveButton = onLeave && !status.toLowerCase().includes('returning');

    return (
        <div className="min-h-screen flex items-center justify-center" role="status" aria-busy="true">
            <div className="flex flex-col items-center gap-6">
                <div
                    className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                />
                <p className="font-headline text-xs tracking-widest uppercase text-emerald-primary text-center max-w-xs px-4">
                    {status}
                </p>
                {showLeaveButton && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onLeave}
                        className="mt-2"
                    >
                        Return to Lobby
                    </Button>
                )}
            </div>
        </div>
    );
}
