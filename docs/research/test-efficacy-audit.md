# Test Efficacy Audit: Vitest and Playwright Suites in frontend-poker

**Date**: October 2026  
**Target Repository**: `frontend-poker` (`c:\Users\benja\IdeaProjects\frontend-poker`)  
**Backend Reference**: `Poker` (`c:\Users\benja\IdeaProjects\Poker`)  
**Scope**: Vitest Unit & Integration Suites (`src/**/__tests__/*`), Playwright E2E Suites (`e2e/*`), and Layout Validation Specs (`scripts/layout/*`).

---

## Executive Summary

The `frontend-poker` test suite demonstrates sophisticated geometric layout verification and browser-level multi-context testing. However, an in-depth audit across the four testing efficacy axes reveals significant structural blind spots:

1. **Implementation Coupling**: Tests frequently couple to internal collaborators (mocking `useGameContext` across 6 component and hook suites), assert exact Tailwind CSS utility classes (e.g., `h-28`, `short:h-12`, `top-full`, `right-full`, `.border-dashed`), and mirror complex math from `tableGeometry.ts` within test assertions rather than validating user-observable outcomes.
2. **Tautological Assertions**: Critical E2E and unit assertions are overly permissive. E2E specs count arbitrary images whose accessible names match `/of/i` without verifying card ranks, suits, or owners; showdown assertions match loose regexes (`/round result|won/i`) without asserting winner identity or chip balances; and 64 layout test cases simply assert that the table root element is visible.
3. **Mock Boundaries**: A production backdoor (`poker-e2e-mock` in [useGameWebSocket.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/useGameWebSocket.ts#L63-L66)) completely bypasses WebSockets in certain `e2e/` tests (`adaptive-table.spec.ts` and `side-pots-visual.spec.ts`), turning them into mock-routed unit tests disguised as E2E. In Vitest, `MockStompClient` provides a blank `publish()` stub with no protocol semantics, and MSW handlers in `handlers.ts` return flat objects that drift from the backend's `ApiResponse<TokenResponse>` contract.
4. **Untested Critical Paths**: High-risk scenarios remain completely unexercised, including STOMP `ERROR` frames, tab wake-up and browser `online` reconnection events, HTTP 15s request timeouts, 429 rate-limiting in UI flows, mid-turn disconnects with draft bet preservation, multi-winner side pot showdowns, and mid-game JWT expiration during active WebSocket sessions.

---

## 1. Implementation Coupling

### 1.1 Mocking Internal Collaborators vs. Testing Public Interfaces

Rather than exercising components through their parent containers or with lightweight providers, multiple test suites aggressively mock internal React hooks and child components.

* **Complete App Mocking**:
  * In [App.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/__tests__/App.test.tsx#L8-L42), the test mocks `useAuthSession` (L8–L10), child component `Lobby` (L12–L31), and child component `GameView` (L33–L42). As a result, `App.test.tsx` only verifies that a dummy `<div data-testid="lobby-view">` or `<div data-testid="game-view">` renders. It provides zero assurance that `App` correctly coordinates real auth state transitions or passes props to `Lobby` or `GameView`.
* **Ubiquitous `useGameContext` Mocking**:
  * In [GameTableView.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/GameTableView.test.tsx#L9-L11), the context hook is mocked via `vi.mock('../../context/GameContext')`.
  * In [GameLobbyView.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/GameLobbyView.test.tsx#L13-L15), `useGameContext` is mocked.
  * In [GameReviewView.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/GameReviewView.test.tsx#L7-L9), `useGameContext` is mocked.
  * In [useGameDispatcher.test.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/__tests__/useGameDispatcher.test.ts#L8-L10), `useGameContext` is mocked.
  * In [useGameWebSocket.test.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/__tests__/useGameWebSocket.test.ts#L8-L10), `useGameContext` is mocked.
  * In [useSessionHydration.test.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/__tests__/useSessionHydration.test.ts#L7-L9), `useGameContext` is mocked.
  * When `GameProvider` internal state shapes change, these mock return values hide state synchronization breakages because each component is tested against an arbitrary mocked object rather than `GameProvider`.
* **Internal Hook Mocking**:
  * In [LiveTableStage.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/LiveTableStage.test.tsx#L10-L12), `useElementSize` is mocked (`vi.mock('../../hooks/useElementSize', ...)`). The component's integration with the DOM resize observer is bypassed, testing only synthetic dimensions injected via a test-scoped `measured` variable.
* **Direct API Service Mocking in Form Components**:
  * In [CreateRoomForm.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/lobby/__tests__/CreateRoomForm.test.tsx#L8-L12) and [JoinRoomForm.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/lobby/__tests__/JoinRoomForm.test.tsx#L9-L13), `pokerApi` is mocked directly using `vi.mock('../../../services/api')`, bypassing the configured MSW network layer that is already established in `setup.ts`.

### 1.2 Ephemeral DOM Structure & CSS Utility Class Coupling

Several component tests assert internal styling classes, DOM nesting structures, and Tailwind CSS utility names instead of verifying accessible roles, visible text, or computed styles.

* **Tailwind Utility Selectors**:
  * In [GameTableView.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/GameTableView.test.tsx#L165-L171), the test asserts:
    ```ts
    expect(screen.getByTestId('room-dock')).toHaveClass('h-28', 'short:h-12');
    ```
    And in L194–L195 and L215–L216:
    ```ts
    const actionSlot = container.querySelector('.h-24');
    expect(actionSlot).toBeInTheDocument();
    ```
    If an engineer replaces `.h-24` with `.h-[6rem]` or flex sizing, the test fails despite identical layout.
  * In [PokerRoomLayout.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/PokerRoomLayout.test.tsx#L31-L33):
    ```ts
    expect(root).toHaveClass('h-[100dvh]');
    expect(root).toHaveClass('flex-col');
    expect(root).toHaveClass('overflow-hidden');
    ```
  * In [CommunityCardsArea.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/CommunityCardsArea.test.tsx#L14,L29,L43,L57,L67), placeholder card slots are selected via `container.querySelectorAll('.border-dashed')`.
  * In [LiveTableStage.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/LiveTableStage.test.tsx#L82):
    ```ts
    expect(stage.className).not.toMatch(/(^|\s)p[xytblr]?-/);
    ```
    This regex prevents any padding utility class from being applied to the element.
* **Child Tree Inspection & Positioning Assertions**:
  * In [GameUIAdversarial.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/GameUIAdversarial.test.tsx#L105-L116):
    ```ts
    const children = Array.from(podEl.children);
    expect(children[0]).toBe(avatarEl);
    if (children.length > 1) {
        for (let i = 1; i < children.length; i++) {
            const child = children[i] as HTMLElement;
            expect(child.className).toContain('absolute');
            expect(child.className).toContain('top-full');
            expect(child.className).toContain('left-1/2');
            expect(child.className).toContain('-translate-x-1/2');
        }
    }
    ```
    And L166–L172 inspects `avatarEl.children` directly and asserts `.className.toContain('absolute')`.
  * In [SeatAnchoring.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/SeatAnchoring.test.tsx#L168), the test asserts:
    ```ts
    expect(big.className).not.toMatch(/\bw-44\b|\bp-3\b|\bmt-2\b/);
    ```
    And in L313–L314:
    ```ts
    expect(details.className).toContain('right-full');
    expect(details.className).not.toContain('top-full');
    ```
    And in L468:
    ```ts
    expect(avatar.className).not.toMatch(/ring-gold-secondary|ring-offset-3|shadow-\[0_0_18px/);
    ```
  * In [SeatPreservation.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/SeatPreservation.test.tsx#L127-L129), styling is inspected via:
    ```ts
    const hasGoldDecoration = (avatar: HTMLElement) =>
        /ring-gold-secondary|252,211,77/.test(avatar.className) || /252,\s*211,\s*77|gold/i.test(avatar.style.boxShadow);
    ```
    And in L323–L324:
    ```ts
    expect(el.closest('.right-full'), ...).not.toBeNull();
    expect(el.closest('.top-full'), ...).toBeNull();
    ```

### 1.3 Synthetic Test Harnesses and Artificial State Bridges

* **DOM-Bridge State Testing**:
  * In [GameProvider.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/context/__tests__/GameProvider.test.tsx#L9-L106) and [GameProvider.integration.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/context/__tests__/GameProvider.integration.test.tsx#L9-L28), `GameProvider` is tested via an artificial `TestConsumer` component.
  * In `GameProvider.integration.test.tsx` (L19–L24 and L50–L63), the test serializes incoming JSON payloads into an HTML button attribute (`applyGameBtn.setAttribute('data-payload', JSON.stringify(...))`) and triggers a synthetic click.
  * Rather than verifying the state machine through real UI interactions or direct reducer/hook calls, the test creates an artificial DOM proxy.

### 1.4 Redundant Formula Recalculation

* In [SeatAnchoring.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/SeatAnchoring.test.tsx#L68-L76,L100-L103,L290-296,L465-468), test assertions re-implement the exact mathematical equations from [tableGeometry.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/lib/tableGeometry.ts):
  ```ts
  const radius = avatarDiameter('md', scale) / 2;
  const expectedOffset = radius + scale * 8 + 4;
  expect(plainCards.style.transform).toBe(`translate(${expectedOffset}px, -50%)`);
  ```
  If the formula in `tableGeometry.ts` produces visual overlap or incorrect positioning, both the implementation and the test compute the identical incorrect value, resulting in false confidence.

---

## 2. Tautological and Permissive Assertions

### 2.1 Wildcard and Trivial Assertions in E2E Suites

Several Playwright end-to-end tests use assertions that pass even when domain data is malformed or incorrect.

* **Counting Images with `/of/i`**:
  * In [e2e/game.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/game.spec.ts#L42-L43):
    ```ts
    await expect(hostPage.getByRole('img', { name: /of/i })).toHaveCount(2);
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);
    ```
    And after the flop (L63):
    ```ts
    await expect(hostPage.getByRole('img', { name: /of/i })).toHaveCount(5);
    ```
  * In [e2e/resilience.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/resilience.spec.ts#L44):
    ```ts
    await expect(guestPage.getByRole('img', { name: /of/i })).toHaveCount(2);
    ```
  * *Efficacy issue*: Any playing card image alt text (e.g. "Ace of Spades", "King of Diamonds", "2 of Clubs") matches `/of/i`. If the backend dealt duplicate cards, invalid suits, or the wrong player received another player's hole cards, `toHaveCount(2)` still passes.
* **Permissive Showdown Outcome Assertions**:
  * In [e2e/comprehensive.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/comprehensive.spec.ts#L84,L136,L191):
    ```ts
    await expect(hostPage.getByText(/round result|won/i).first()).toBeVisible({ timeout: 20000 });
    ```
  * *Efficacy issue*: This regex matches "Round Result" OR "won". It asserts neither *who* won the hand, *how many chips* were awarded, whether chip balances updated, nor what hand rank took the pot. Even if the wrong player was declared winner or the server errored with "Could not determine who won", the assertion passes.
* **Layout Screenshot Suites Asserting Trivial Visibility**:
  * In [scripts/layout/layout-screenshots.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/scripts/layout/layout-screenshots.spec.ts#L112,L154):
    ```ts
    await expect(page.getByRole('region', { name: /poker table/i })).toBeVisible();
    ```
  * *Efficacy issue*: This spec iterates over 8 player counts (3–10) and 8 viewports (64 executions per test run), taking PNG screenshots, but its only programmatic assertion is that `<section aria-label="Poker Table">` is visible. It performs zero collision detection, bounding box verification, or font legibility checks (those exist only in `layout-overlap.spec.ts`).

### 2.2 Asserting Self-Constructed Data (Testing Mocks Against Themselves)

* In [GameProvider.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/context/__tests__/GameProvider.test.tsx#L24-L35,L144-L151):
  The test clicks a mock button that dispatches `{ roomId: 'test-room', roomName: 'High Roller Suite' }`, and then immediately asserts:
  ```ts
  expect(screen.getByTestId('room-name')).toHaveTextContent('High Roller Suite');
  ```
  And in L42–L54, it dispatches `{ pot: 1200, phase: 'FLOP' }` and asserts pot is 1200.
  This validates that React state stores what was passed to `dispatch`, but does not test real domain invariants or validation rules.
* In [GameProvider.integration.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/context/__tests__/GameProvider.integration.test.tsx#L50-L67):
  The test feeds `{ phase: 'SHOWDOWN', pot: 100 }` into `applyIncomingGameState` and immediately asserts:
  ```ts
  expect(screen.getByTestId('game-phase')).toHaveTextContent('SHOWDOWN');
  expect(screen.getByTestId('showdown-result')).toHaveTextContent('present');
  ```
* In [LoadingView.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/LoadingView.test.tsx#L8-L11):
  ```ts
  expect(element).toHaveAttribute('aria-busy', 'true');
  ```
  The component has a static `aria-busy="true"` attribute in its JSX. Asserting static attributes on presentational components provides trivial coverage without testing loading transitions.

---

## 3. Mock Boundaries and Contract Drift

### 3.1 STOMP / WebSocket Mock Boundary (`MockStompClient`)

In [src/test/mocks/stomp.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/test/mocks/stomp.ts#L6-L70), `MockStompClient` replaces `@stomp/stompjs`:

* **No-op `publish()`**:
  ```ts
  publish() {}
  ```
  In [stomp.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/test/mocks/stomp.ts#L29), `publish()` does nothing. When components or hooks dispatch game actions (e.g., FOLD, CHECK, RAISE) to `/app/{gameId}/action`, no destination parsing, frame validation, or response simulation occurs.
* **No STOMP Protocol Semantics**:
  * Frames, headers, connection handshakes, heartbeats, and transactions are completely omitted.
  * `activate()` calls `setTimeout(() => this.onConnect(), 0)` synchronously.
* **Single-Client Limitation**:
  * `MockStompClient.activeInstance` is a static property (L7). If a test mounts two components or simulates multiple players in Vitest, only the last created instance can receive messages or simulate disconnects.
* **Untested STOMP Error Frames**:
  * `onStompError: (frame) => {}` (L10) is defined on the class, but is never invoked or tested anywhere across the Vitest suite.

### 3.2 MSW REST Handlers and Backend Contract Drift

In [src/test/mocks/handlers.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/test/mocks/handlers.ts#L5-L30):

* **Contract Drift in Auth Endpoints**:
  * The MSW mock returns:
    ```ts
    // handlers.ts L15-19
    return HttpResponse.json({
      token: 'mock-jwt-token',
      playerName,
      roomId: roomName
    })
    ```
  * In the Spring Boot backend ([RoomController.java](file:///c:/Users/benja/IdeaProjects/Poker/src/main/java/com/pokergame/controller/RoomController.java#L75-L77,L102-L104)):
    ```java
    TokenResponse tokenResponse = new TokenResponse(token, roomId, sanitizedPlayerName);
    return ResponseEntity.ok(ApiResponse.success("Successfully joined room", tokenResponse));
    ```
    The real backend payload format is:
    ```json
    {
      "status": "SUCCESS",
      "message": "Successfully joined room",
      "data": {
        "token": "...",
        "roomId": "...",
        "playerName": "..."
      }
    }
    ```
  * In [src/services/api.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/services/api.ts#L46-L57), the client works around this drift:
    ```ts
    function normalizeAuthResponse(raw: unknown): AuthResponse {
        const src = (raw ?? {}) as Record<string, unknown>;
        const data = (src.data ?? src) as Record<string, unknown>;
        ...
    }
    ```
    MSW tests against the flattened schema (`src`), masking any regressions if the backend changes its `ApiResponse` wrapper structure.
* **Missing Default Handlers**:
  * `handlers.ts` has no handlers for:
    * `POST /api/room/:roomId/leave`
    * `POST /api/game/:gameId/leave`
    * `POST /api/room/:roomId/start-game`
    * `POST /api/game/:gameId/claim-win`
  * Tests that invoke these endpoints without explicit per-test `server.use()` definitions encounter unhandled MSW request errors.

### 3.3 The `poker-e2e-mock` Backdoor in Production Code

A critical mock boundary issue exists in [src/hooks/useGameWebSocket.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/useGameWebSocket.ts#L63-L67):

```ts
const isE2EMock = typeof window !== 'undefined' && window.localStorage.getItem('poker-e2e-mock') === 'true';
if (isE2EMock) {
    dispatch({ type: 'SET_WS_STATUS', payload: 'connected' });
    return;
}
```

* **Impact on E2E Suites**:
  * In [e2e/adaptive-table.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/adaptive-table.spec.ts#L198,L262,L339) and [e2e/side-pots-visual.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/side-pots-visual.spec.ts#L36), the tests inject `window.localStorage.setItem('poker-e2e-mock', 'true')`.
  * In [scripts/layout/layout-overlap.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/scripts/layout/layout-overlap.spec.ts#L800) and [scripts/layout/layout-screenshots.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/scripts/layout/layout-screenshots.spec.ts#L46), `poker-e2e-mock` is also injected.
* **Consequence**:
  * Any spec setting this flag completely halts WebSocket initialization. `createStompClient` is never called.
  * The spec then intercepts all REST calls using Playwright's `page.route()` (e.g. `e2e/side-pots-visual.spec.ts` L42–L92).
  * Despite residing in the `e2e/` folder, these tests do not run against the Spring Boot backend or a real WebSocket broker. They are isolated frontend tests executing inside Playwright.
* **Contrast with Real E2E Specs**:
  * [e2e/game.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/game.spec.ts), [e2e/lobby.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/lobby.spec.ts), [e2e/comprehensive.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/comprehensive.spec.ts), [e2e/resilience.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/resilience.spec.ts), [e2e/form-validation.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/form-validation.spec.ts), and [e2e/cross-tab-auth.spec.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/e2e/cross-tab-auth.spec.ts) do *not* set `poker-e2e-mock`. They connect real browser contexts to the live Spring Boot server spawned by [playwright.config.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/playwright.config.ts#L34-L43).
  * The `e2e/` directory contains an undocumented mixture of real backend integration tests and mock-intercepted layout tests.

---

## 4. Untested Critical Paths

### 4.1 Connection & Resilience

* **STOMP ERROR Frame Handling**:
  * In [useGameWebSocket.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/useGameWebSocket.ts#L260-L263):
    ```ts
    client.onStompError = (frame) => {
        logger.warn('STOMP error:', frame.headers['message']);
        dispatch({ type: 'SET_WS_STATUS', payload: 'reconnecting' });
    };
    ```
  * Zero tests in `useGameWebSocket.test.ts` or integration tests trigger `onStompError`.
* **Tab Visibility Wake-up (`visibilitychange`)**:
  * In [useGameWebSocket.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/useGameWebSocket.ts#L270-L277):
    ```ts
    const handleWakeup = () => {
        if (document.visibilityState === 'visible' && !client.connected) {
            if (typeof client.forceDisconnect === 'function') client.forceDisconnect();
            client.activate();
        }
    };
    ```
  * No test verifies that switching tabs or un-minimizing the browser triggers reconnection.
* **Browser `online` Event Recovery**:
  * In [useGameWebSocket.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/useGameWebSocket.ts#L279-L285):
    ```ts
    const handleOnline = () => {
        if (!client.connected) {
            if (typeof client.forceDisconnect === 'function') client.forceDisconnect();
            client.activate();
        }
    };
    ```
  * No test verifies browser online recovery.
* **15-Second Fetch Timeout (`AbortController`)**:
  * In [api.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/services/api.ts#L5,L79-L81):
    ```ts
    const REQUEST_TIMEOUT_MS = 15000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    ```
  * In [api.test.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/services/__tests__/api.test.ts), there are no tests ensuring that requests exceeding 15 seconds abort cleanly or produce expected errors.
* **HTTP 429 Rate Limiting in UI Flows**:
  * While [api.test.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/services/__tests__/api.test.ts#L160-L175) verifies that status 429 returns `'Too many requests. Please try again later.'`, no integration test exercises how the UI behaves when 429 is encountered during room creation, room joining, or game actions.
* **Mid-Action Disconnect**:
  * If a user opens the Raise dialog, types an amount, and the WebSocket disconnects before submission: does the UI preserve the draft raise amount upon reconnecting? Untested.

### 4.2 Table Actions & Showdown Logic

* **Multi-Winner Side Pots Won by Different Players**:
  * In [ResultDock.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/ResultDock.tsx#L25-L42,L72-L76):
    ```ts
    const winners = showdownResult.winners ?? [];
    ...
    {showdownResult.winningsPerPlayer != null && (
        <span>+{showdownResult.winningsPerPlayer.toLocaleString()} Chips</span>
    )}
    ```
  * `ResultDock` assumes a single flat `winningsPerPlayer` value applied to all winners. If Player A wins Main Pot ($300) and Player B wins Side Pot 1 ($200), `showdownResult.winningsPerPlayer` cannot accurately communicate separate payouts.
  * No test in Vitest or Playwright exercises a multi-winner scenario where distinct pots are awarded to different players.
* **Odd Chip Distribution in Split Pots**:
  * In split pots with odd chip totals (e.g., 75 chips split between 2 players), the backend awards the odd chip to the player closest to the dealer. No test verifies how the frontend displays unequal split payouts.
* **Action Input Boundaries & Non-Numeric Entries**:
  * In [ActionPanel.test.tsx](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/components/__tests__/ActionPanel.test.tsx), tests verify clicking preset buttons (`3bb`, `1/2 pot`, `pot`, `max`). No test exercises typing invalid inputs directly into the numeric field: negative values, decimal numbers, strings, or values exceeding player chip stacks.
* **Server-Enforced Turn Timeout (Auto-Fold/Auto-Check)**:
  * When a player fails to act before the backend turn countdown expires, the backend automatically folds or checks. No test verifies that the frontend correctly clears pending states and displays the auto-action.

### 4.3 Session Hydration & Authentication

* **Mid-Game JWT Expiration**:
  * In [api.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/services/api.ts#L60-L72,L89-L93), `isJwtValid(token)` is checked exclusively during HTTP `fetchApi` calls.
  * During active gameplay, game state updates and player actions flow over WebSocket STOMP frames, which bypass `fetchApi`.
  * If a user's JWT expires during a hand, the STOMP connection remains active until the backend rejects a frame or closes the socket. No test checks what happens when a JWT expires mid-game.
* **Server 500 / Malformed Payload During Initial Hydration**:
  * In [useSessionHydration.test.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/__tests__/useSessionHydration.test.ts), tests cover successful hydration (L57), 403 redirect (L95), and 120s timeout (L121).
  * Server 500 errors, network dropouts during initial GET `/api/room/{roomId}`, or malformed JSON payloads are not tested.

---

## 5. Comparative Audit Matrix

| Test Suite / File | Implementation Coupling | Tautological Assertions | Mock Boundary Quality | Untested Critical Paths |
| :--- | :--- | :--- | :--- | :--- |
| **`src/__tests__/App.test.tsx`** | **High**: Mocks `useAuthSession`, `Lobby`, `GameView` (L8–42). | **Medium**: Asserts presence of mock testids (L67–70). | **N/A**: Pure mock unit test. | Real navigation & auth transitions. |
| **`src/__tests__/GameView.*.test.tsx`** | **Low**: Renders `GameView` with real providers & subcomponents. | **Low**: Verifies user-visible text, buttons, regions. | **Medium**: Uses MSW & `MockStompClient`. | Network timeout; STOMP error frame. |
| **`src/context/__tests__/GameProvider.*`** | **High**: Tests state machine via artificial DOM test button bridge (`setAttribute('data-payload')`). | **High**: Asserts self-injected payload fields back. | **N/A**: Tests context in isolation. | Concurrent out-of-order STOMP payloads with active turn timer. |
| **`src/hooks/__tests__/useGameWebSocket.test.ts`** | **High**: Mocks `useGameContext` (L8) and `pokerApi` (L12). | **Low**: Verifies subscription paths and dispatched actions. | **Medium**: Relies on static `MockStompClient`. | `client.onStompError`, `handleWakeup`, `handleOnline`. |
| **`src/components/__tests__/GameTableView.test.tsx`** | **High**: Mocks `useGameContext`; queries `.h-24`, `.h-28`, `short:h-12`. | **Medium**: Tests CSS class existence. | **N/A**: Isolated component test. | User action handling during reconnection. |
| **`src/components/__tests__/SeatAnchoring.test.tsx`** | **High**: Directly recalculates geometry formulas and asserts styles; negative Tailwind regex checks. | **High**: Mirrors implementation math in test assertions. | **N/A**: Pure component geometry test. | True visual rendering flaws in formulas. |
| **`src/components/__tests__/GameUIAdversarial.test.tsx`** | **High**: Inspects DOM child indices; asserts `w-full`, `h-full`, `absolute`, `top-full`. | **Low**: Thorough edge case fuzzing on cards/avatars. | **N/A**: Pure component unit test. | Responsive resizing mid-animation. |
| **`e2e/game.spec.ts` & `comprehensive.spec.ts`** | **Low**: Drives real browser pages via public UI. | **High**: Counts images with `/of/i`; showdown checks match `/round result\|won/i`. | **Excellent**: Real Spring Boot backend & real WebSocket broker. | Multi-pot side-pot split resolutions; player timeout auto-fold. |
| **`e2e/side-pots-visual.spec.ts` & `adaptive-table.spec.ts`** | **Low**: Verifies visual bounding boxes and collisions. | **Low**: Strong collision detection math. | **Fragile**: Injects `poker-e2e-mock`; kills WebSocket; mocks REST with `page.route()`. | Real backend side-pot computation; real WebSocket payload sync. |
| **`scripts/layout/layout-screenshots.spec.ts`** | **Low**: Browser-based screenshot runner. | **Critical**: Asserts only `poker table` region visibility across 64 combinations. | **Mocked**: Injects `poker-e2e-mock` and mocks REST. | All layout assertions (delegated to overlap spec). |

---

## 6. Recommendations

1. **Remove the `poker-e2e-mock` Backdoor from Production Code**:
   * Refactor [useGameWebSocket.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/hooks/useGameWebSocket.ts#L63-L66) so test hooks are not bundled in production code.
   * If offline layout testing is required, inject a mock transport adapter via dependency injection or a build-time test entrypoint, rather than reading `localStorage` inside production hooks.
   * Move `e2e/adaptive-table.spec.ts` and `e2e/side-pots-visual.spec.ts` to `scripts/layout/` or clearly designate them as offline layout tests to distinguish them from true end-to-end integration tests.
2. **Align MSW Handlers with Spring Boot Backend Schemas**:
   * Update [handlers.ts](file:///c:/Users/benja/IdeaProjects/frontend-poker/src/test/mocks/handlers.ts#L15-L29) so `POST /api/room/join` and `POST /api/room/create` return `{ message: "...", data: { token, roomId, playerName } }` matching `ApiResponse<TokenResponse>`.
   * Add default handlers for `/leave`, `/start-game`, and `/claim-win` to avoid reliance on manual `pokerApi` spying.
3. **Replace Ephemeral CSS Class Assertions with Accessible Invariants**:
   * Replace `container.querySelector('.h-24')` and `toHaveClass('h-28')` in `GameTableView.test.tsx` with semantic role/region queries or bounding box assertions.
   * Replace `.border-dashed` queries in `CommunityCardsArea.test.tsx` with accessible slot labels or roles.
   * In `GameUIAdversarial.test.tsx`, assert computed styles (`getComputedStyle`) or layout bounding boxes rather than verifying that DOM child elements have literal strings `absolute`, `top-full`, `left-1/2`.
4. **Strengthen E2E Assertions**:
   * In `e2e/game.spec.ts`, replace `toHaveCount(2)` on `/of/i` with assertions targeting specific dealt cards (e.g. `getByRole('img', { name: /ace of spades/i })`).
   * In `e2e/comprehensive.spec.ts`, replace `/round result|won/i` with assertions verifying the specific winner name, winning hand rank, and final chip count updates.
5. **Implement Missing Critical Path Tests**:
   * Add Vitest unit tests in `useGameWebSocket.test.ts` for `client.onStompError`, `handleWakeup` (`visibilitychange`), and `handleOnline`.
   * Add unit tests in `api.test.ts` verifying that `fetchApi` times out after 15,000ms.
   * Add a test in `GameView.roundSummary.integration.test.tsx` for multi-winner side pots where different players win the main pot and side pot.
