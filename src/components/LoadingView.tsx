import { Button } from './UI';
import { BTN_RETURN_TO_LOBBY } from '../constants/strings';

interface LoadingViewProps {
    status: string;
    onLeave?: () => void;
}

export function LoadingView({ status, onLeave }: LoadingViewProps) {
    return (
        <div className="flex items-center justify-center h-full w-full" role="status" aria-busy="true">
            <div className="flex flex-col items-center gap-6">
                <div
                    className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                />
                <p className="font-headline text-xs tracking-widest uppercase text-emerald-primary text-center max-w-xs px-4">
                    {status}
                </p>
                {onLeave && (
                    <Button variant="outline" size="sm" onClick={onLeave}>
                        {BTN_RETURN_TO_LOBBY}
                    </Button>
                )}
            </div>
        </div>
    );
}
