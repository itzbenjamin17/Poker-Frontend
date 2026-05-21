import { useCallback, useRef, useState } from 'react';
import type { ShowdownModalLayout, ShowdownModalInteractionState } from '../types';

const PADDING_PX = 12;
const MIN_WIDTH_PX = 260;
const MIN_HEIGHT_PX = 180;
const MAX_WIDTH_PX = 520;

function clampLayout(layout: ShowdownModalLayout): ShowdownModalLayout {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const maxWidth = Math.min(MAX_WIDTH_PX, Math.max(1, vw - PADDING_PX * 2));
    const minWidth = Math.min(MIN_WIDTH_PX, maxWidth);
    const width = Math.max(minWidth, Math.min(layout.width, maxWidth));

    const maxHeight = Math.max(1, vh - PADDING_PX * 2);
    const minHeight = Math.min(MIN_HEIGHT_PX, maxHeight);
    const height = Math.max(minHeight, Math.min(layout.height, maxHeight));

    const minX = PADDING_PX;
    const maxX = Math.max(minX, vw - width - PADDING_PX);
    const minY = PADDING_PX;
    const maxY = Math.max(minY, vh - height - PADDING_PX);

    return {
        x: Math.max(minX, Math.min(layout.x, maxX)),
        y: Math.max(minY, Math.min(layout.y, maxY)),
        width,
        height,
    };
}

export function useShowdownModal() {
    const [layout, setLayout] = useState<ShowdownModalLayout | null>(null);
    const modalRef = useRef<HTMLDivElement | null>(null);
    const interactionRef = useRef<ShowdownModalInteractionState | null>(null);

    const resetLayout = useCallback(() => setLayout(null), []);

    const clampCurrentLayout = useCallback((prev: ShowdownModalLayout | null) => {
        if (!prev) return prev;
        const clamped = clampLayout(prev);
        if (
            clamped.x === prev.x &&
            clamped.y === prev.y &&
            clamped.width === prev.width &&
            clamped.height === prev.height
        ) {
            return prev;
        }
        return clamped;
    }, []);

    const ensureLayout = useCallback((): ShowdownModalLayout | null => {
        if (layout) return layout;
        const el = modalRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const measured = clampLayout({
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        });
        setLayout(measured);
        return measured;
    }, [layout]);

    const onWindowResize = useCallback(() => {
        setLayout(clampCurrentLayout);
    }, [clampCurrentLayout]);

    const onDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, onStop?: () => void) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const baseline = ensureLayout();
        if (!baseline) return;
        if (onStop) onStop();
        interactionRef.current = {
            mode: 'drag',
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startLayout: baseline,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    }, [ensureLayout]);

    const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, onStop?: () => void) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const baseline = ensureLayout();
        if (!baseline) return;
        if (onStop) onStop();
        interactionRef.current = {
            mode: 'resize',
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startLayout: baseline,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    }, [ensureLayout]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== e.pointerId) return;

        const dx = e.clientX - interaction.startClientX;
        const dy = e.clientY - interaction.startClientY;

        if (interaction.mode === 'drag') {
            setLayout(clampLayout({ ...interaction.startLayout, x: interaction.startLayout.x + dx, y: interaction.startLayout.y + dy }));
        } else {
            setLayout(clampLayout({ ...interaction.startLayout, width: interaction.startLayout.width + dx, height: interaction.startLayout.height + dy }));
        }
        e.preventDefault();
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>, onResume?: () => void) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== e.pointerId) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        interactionRef.current = null;
        if (onResume) onResume();
    }, []);

    return {
        layout,
        setLayout,
        resetLayout,
        modalRef,
        onWindowResize,
        onDragPointerDown,
        onResizePointerDown,
        onPointerMove,
        onPointerUp,
    };
}
