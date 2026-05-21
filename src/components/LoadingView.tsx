interface LoadingViewProps {
    status: string;
}

export function LoadingView({ status }: LoadingViewProps) {
    return (
        <div className="min-h-screen flex items-center justify-center" role="status" aria-busy="true">
            <div className="flex flex-col items-center gap-4">
                <div
                    className="w-12 h-12 border-4 border-emerald-primary border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                />
                <p className="font-headline text-xs tracking-widest uppercase text-emerald-primary">
                    {status}
                </p>
            </div>
        </div>
    );
}
