import { describe, expect, it } from 'vitest';
import securityHeadersConf from '../../../security-headers.conf?raw';
import nginxConf from '../../../nginx.conf?raw';
import dockerfile from '../../../Dockerfile?raw';
import indexHtml from '../../../index.html?raw';

const files: Record<string, string> = {
    'security-headers.conf': securityHeadersConf,
    'nginx.conf': nginxConf,
    Dockerfile: dockerfile,
    'index.html': indexHtml,
};
const read = (file: string) => files[file];

function headers(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [, name, value] of read('security-headers.conf').matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)) {
        map.set(name, value);
    }
    return map;
}

function cspDirectives(): Map<string, string[]> {
    const csp = headers().get('Content-Security-Policy') ?? '';
    return new Map(
        csp.split(';').map(d => d.trim()).filter(Boolean).map(d => {
            const [name, ...values] = d.split(/\s+/);
            return [name, values] as [string, string[]];
        }),
    );
}

describe('security headers', () => {
    it('sends a CSP that allows no inline or eval script', () => {
        const scriptSrc = cspDirectives().get('script-src');
        expect(scriptSrc).toEqual(["'self'"]);
    });

    it('locks down plugins, base URLs, framing and DOM XSS sinks', () => {
        const csp = cspDirectives();
        expect(csp.get('object-src')).toEqual(["'none'"]);
        expect(csp.get('base-uri')).toEqual(["'none'"]);
        expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
        expect(csp.get('require-trusted-types-for')).toEqual(["'script'"]);
    });

    it('sends the standard hardening headers', () => {
        const h = headers();
        expect(h.get('X-Content-Type-Options')).toBe('nosniff');
        expect(h.get('X-Frame-Options')).toBe('DENY');
        expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(h.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    });

    it('is included wherever nginx sets its own headers, so none are dropped', () => {
        const conf = read('nginx.conf');
        const includes = conf.match(/include\s+\/etc\/nginx\/snippets\/security-headers\.conf;/g) ?? [];
        const locationsWithAddHeader = [...conf.matchAll(/location[^{]*\{[^}]*add_header[^}]*\}/g)];
        // One at server level, plus one in every location that has its own add_header.
        expect(includes.length).toBe(1 + locationsWithAddHeader.length);
        for (const [block] of locationsWithAddHeader) {
            expect(block).toContain('security-headers.conf');
        }
        expect(read('Dockerfile')).toContain('security-headers.conf /etc/nginx/snippets/security-headers.conf');
    });

    it('does not keep a weaker CSP meta tag in index.html', () => {
        expect(read('index.html')).not.toMatch(/http-equiv=["']Content-Security-Policy["']/i);
    });
});
