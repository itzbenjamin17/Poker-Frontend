import React from 'react';
import { cn } from '../types';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const Button = ({
                           children,
                           variant = 'primary',
                           size = 'md',
                           className,
                           ...props
                       }: ButtonProps) => {
    const variants = {
        primary: 'bg-gold-secondary text-surface font-headline font-extrabold shadow-[0_12px_24px_rgba(252,192,37,0.2)] hover:shadow-gold-secondary/30 active:scale-95',
        secondary: 'bg-emerald-container text-surface font-headline font-bold shadow-lg hover:shadow-emerald-primary/10 active:scale-95',
        outline: 'border border-emerald-primary/20 text-emerald-primary hover:bg-emerald-primary/10 active:scale-95',
        ghost: 'text-zinc-500 hover:text-emerald-primary active:scale-95',
    };

    const sizes = {
        xs: 'px-2.5 py-1 text-[10px]',
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-6 py-2.5 text-sm',
        lg: 'px-8 py-4 text-lg',
        xl: 'px-10 py-5 text-xl',
    };

    return (
        <button
            className={cn(
                'rounded-xl transition-all duration-200 flex items-center justify-center gap-2 uppercase tracking-tight',
                variants[variant],
                sizes[size],
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
};

export const Input = ({ label, error, ...props }: { label?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="space-y-2 w-full">
        {label && (
            <label className="block font-headline text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                {label}
            </label>
        )}
        <input
            className={cn(
                "w-full bg-surface-highest border-none rounded-lg p-4 text-white placeholder:text-white/20 focus:ring-1 focus:ring-emerald-primary/30 transition-all font-body outline-none",
                error && "ring-1 ring-red-500/50"
            )}
            {...props}
        />
        {error && <p className="text-[10px] text-red-500 uppercase tracking-wider">{error}</p>}
    </div>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string; glint?: boolean }> = ({ children, className, glint = true }) => (
    <div className={cn("glass-card rounded-2xl p-8 relative overflow-hidden group", className)}>
        {glint && (
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-primary/10 via-transparent to-transparent pointer-events-none" />
        )}
        <div className="relative z-10">{children}</div>
    </div>
);
