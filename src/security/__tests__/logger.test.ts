// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { logger } from '../logger';

describe('logger security', () => {
    it('redacts Bearer tokens and sensitive object keys in logger output', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const secretToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAliceJ9.secret-signature';
            logger.log(`Header Authorization: Bearer ${secretToken}`, {
                token: secretToken,
                password: 'my-secret-password',
                holeCards: ['AS', 'KS'],
                safeField: 'visible',
            });

            expect(logSpy).toHaveBeenCalledTimes(1);
            const [loggedMsg, loggedObj] = logSpy.mock.calls[0];
            expect(loggedMsg).not.toContain(secretToken);
            expect(loggedMsg).toContain('Bearer [REDACTED]');
            expect(loggedObj).toEqual({
                token: '[REDACTED]',
                password: '[REDACTED]',
                holeCards: '[REDACTED]',
                safeField: 'visible',
            });

            logger.warn('Private frame: {"holeCards":["AH","KH"]}');
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).not.toContain('AH');
        } finally {
            logSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it('redacts serialized sensitive JSON and sensitive properties attached to Error instances', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sensitiveError = Object.assign(new Error('Request failed'), {
            token: 'secret-token',
            holeCards: ['AS', 'KS'],
            safeField: 'visible',
        });

        try {
            logger.warn('Serialized', '{"token":"secret-token","holeCards":["AS","KS"]}');
            logger.error('Failure', sensitiveError);

            expect(warnSpy.mock.calls[0][1]).toBe('[Sensitive serialized payload redacted]');
            expect(errorSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
                token: '[REDACTED]',
                holeCards: '[REDACTED]',
                safeField: 'visible',
                message: 'Request failed',
            }));
        } finally {
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });
});
