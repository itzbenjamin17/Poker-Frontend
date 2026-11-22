# Manual checks

Run these in order, in the built-in browser, with the backend config each section names (see SKILL.md, "Backend configs"). Each check says what to do and what a pass looks like. Where a check asks you to judge, give your reasons in the notes column, along with a screenshot path when the look is the point.

## FAST config

**M01 Table at 2, 6 and 10 players.** Seat 2, then 6, then 10 players (one tab each) and start a game each time. In the hero's tab, use `resize_window` for 1366×768, 1024×600 and 844×390, and take a screenshot at each size. Also open the suite's `test-results/playtest/screens/ten-players-*.png`.
Pass: the hero sits bottom-centre; opponents are spread evenly around the felt; no name, stack, bet, card or dealer/blind marker overlaps or clips another or the board; and every number is legible at every size.

**M02 Showdown presentation.** Play hands to showdown until you've seen a single winner and, if it happens, a split pot or a board-plays hand (NOT-SEEN is fine for the last two).
Pass: the winner is obvious at a glance; the hand names read naturally ("Two Pair", not `TWO_PAIR`); the pot chip says "Won"; the result dock's names and amounts match the state probe; folded players' cards stay hidden.

**M03 Side-pot readability.** Three players, buy-in 200, blinds 10/20. Hand 1: everyone folds to the big blind. Hand 2: everyone goes all in (the biggest stack calls when All In isn't offered).
Pass: during the runout, the main pot, side pot and any uncalled amount are clearly labelled, the "+N Side Pot" toggle and the pot details make sense to a first-time player, and the amounts match the probe's `pots`.

**M04 Raise panel.** On a turn where Raise or Bet is offered, try each preset (3BB, 1/2 POT, POT, MAX), the slider with the arrow keys, and Cancel.
Pass: each preset lands on the amount its name promises (allowing for the call it includes and the min/max clamp); arrow keys move the slider; the amount label tracks it; Cancel closes the panel and returns focus to the button that opened it.

**M05 Feedback and notifications.** Watch the whole flow for pending states ("Submitting...", "CREATING...", "STARTING..."), notifications and animations.
Pass: every action shows feedback within about a second; notifications are readable and close with the "Close notification" button; animations never hide the information you need to act.

**M06 Keyboard only.** Using only `computer` key presses (Tab, Shift+Tab, Enter, Space, Escape, arrows), create a room in one tab, join from a second, start, play a hand, mark READY, and leave through the confirmation dialog. Take a screenshot whenever focus moves somewhere new.
Pass: everything can be reached; focus is always visible; it moves into the leave dialog and Escape closes it; the order follows the layout.

**M07 Copy review.** Note every piece of text you saw during the run: errors, notices, labels, the review screen.
Pass: messages are clear and consistent; no raw error codes (`MIN_RAISE`), `undefined`, `NaN` or broken pluralisation. The "60s / 30 min / 15 min" labels are hardcoded, so they're wrong under FAST. Note that and check them under DEFAULTS (M15).

**M08 Heads-up timeout message.** Heads-up, let the first actor's turn run out, then reload that player's tab.
Pass: both players land on GAME OVER; the timed-out player reads "You ran out of time on your turn." and the winner reads "<name> ran out of time on their turn.", and the note is still there after the reload. (In 3+ player games the timed-out player instead sees "removed from the table due to turn timeout".)

**M09 Finished-room name.** As soon as a game ends (the review is showing), create a new room with the same name from a fresh tab.
Pass: the new room is created straight away; the finished room's players can still read their review.

**M10 Busting out of a 3+ player game.** Three players, buy-in 100, blinds 10/20. Go all in each hand until one player has no chips left while the other two play on.
Pass: from the next hand the busted player's dock reads "You're out of chips" with a LEAVE TABLE button that takes them to the main lobby; the others' table drops the seat, their header counts only players still in, and play carries on. A stuck or erroring screen for the busted player is a FAIL.

**M11 Server down mid-hand.** Use DEFAULTS, so the 60 s turn timer doesn't end the hand before you stop the server. During a hand, stop the backend (the command is in SKILL.md). Watch both tabs for 60 seconds, then start it again.
Pass: the reconnect overlay appears at once and keeps retrying by itself (during a real outage it doesn't give up, so no "Retry connection" button is expected); after the restart, the tabs leave the gone game and return to the main lobby instead of hanging or showing an error screen.

## RATE config

**M12 Rate limits.** From a shell, send 20 quick join requests from this machine to `http://localhost:8080/api/room/join` (any body), then submit the Join form in a tab. Separately, in a fresh password-protected room, enter the wrong password 10 times and then the right one.
Pass: the form shows the server's "Too many requests…" message (not a generic error); the 11th password attempt is refused with a clear message even when it's correct; normal play in an existing table is unaffected.

## PERSIST config

**M13 Restart recovery.** Start a 3-player game. Stop the backend mid-hand, at a point where you know every stack, the pot, the board and whose turn it is. Restart PERSIST. Then repeat the stop and restart during the ready countdown, and again on a finished game's review screen.
Pass: each tab reconnects on its own to the same hand, cards, stacks, pot and actor; the turn and countdown timers carry on (an overdue timer firing straight away is fine); the review still loads; `backend.log` shows recovery without errors.

## ABANDON config

**M14 Game abandonment.** Two players. Finish a hand, then send one tab to `about:blank` so the table waits for players. Don't claim the win. Wait about 2.5 minutes.
Pass: the remaining player sees "Table Inactivity Warning" about 2 minutes before the end, then a "GAME ABANDONED" review with "Closed due to inactivity" and "Chips when play stopped".

## DEFAULTS config

**M15 Real timings.** Play two hands with the real timers. Let one ready countdown run all the way down and one all-in runout play out.
Pass: the turn countdown and warning badge tick once a second and hit 0 on time; the runout deals about 4 s per street; the 30 s ready countdown counts down correctly; the lobby's "60s / 30 min / 15 min" labels match these timings.

**M16 Phone-sized window.** Use `resize_window` with preset `mobile` (375×812, portrait), reload, then use 812×375 (landscape) and 667×375.
Pass: portrait shows the rotate prompt; in landscape the table, the dock and the raise panel can all be used, and nothing needed to act is off-screen.

## HUMAN (record as BLOCKED with "needs a human")

- H1 Play on a real phone over LAN or ngrok (touch targets, the on-screen keyboard over the forms).
- H2 Put the laptop to sleep mid-hand and wake it.
- H3 Turn on the OS "reduce motion" setting and play a hand.
- H4 A screen-reader pass with NVDA: seats, cards, pot and turn announcements.
- H5 Close a player's tab mid-game and restore it with Ctrl+Shift+T. That's the only way back in, since a started game refuses joins.
