/**
 * All user-facing string constants for Vault Poker.
 * Grouped by feature area for future i18n support.
 */

// ─── App / Nav ────────────────────────────────────────────────────────────────
export const APP_NAME = 'VAULT POKER';
export const NAV_LOBBY = 'Lobby';
export const NAV_TABLES = 'Tables';

// ─── Auth / Session ───────────────────────────────────────────────────────────
export const AUTH_KEY = 'poker-auth';
export const SESSION_RESTORING = 'Restoring your seat...';
export const SESSION_EXPIRED = 'Session expired. Returning to lobby...';
export const SESSION_SEAT_GONE = 'Your seat is no longer active. Returning to lobby...';

// ─── Connection ───────────────────────────────────────────────────────────────
export const STATUS_CONNECTING = 'Connecting...';
export const STATUS_CONNECTED = 'Connected.';
export const STATUS_RECONNECTING = 'Reconnecting...';
export const STATUS_SEAT_RESTORED = 'Seat restored. Syncing live updates...';
export const STATUS_RECONNECTING_TABLE = 'Reconnecting to table...';
export const STATUS_RETURNING = 'Returning...';
export const STATUS_WAITING_CONNECTION = 'Waiting for table connection...';
export const STATUS_SYSTEM_MALFUNCTION = 'System malfunction. Please refresh.';

// ─── Lobby ────────────────────────────────────────────────────────────────────
export const LOBBY_HERO_SUBTITLE = 'The High-Stakes Experience';
export const LOBBY_HERO_TITLE_1 = 'UNCOMPROMISED';
export const LOBBY_HERO_TITLE_2 = 'ROYAL ACTION.';

export const CREATE_TABLE_HEADING = 'Create Table';
export const CREATE_TABLE_SUBTITLE = 'Define the stakes and command the room.';
export const BTN_ESTABLISH = 'ESTABLISH TABLE';
export const BTN_ESTABLISHING = 'ESTABLISHING...';

export const JOIN_TABLE_HEADING = 'Quick Join';
export const JOIN_TABLE_SUBTITLE = 'Enter an existing arena.';
export const BTN_JOIN = 'ENTER VAULT';
export const BTN_JOINING = 'ENTERING...';

export const ERROR_CREATE_FALLBACK = 'Failed to create room. Please check your connection.';
export const ERROR_JOIN_FALLBACK = 'Failed to join room. Room may not exist or password is incorrect.';

// ─── Game Lobby ───────────────────────────────────────────────────────────────
export const GAME_LOBBY_LABEL = 'Live Table';
export const GAME_LOBBY_HEADING_PREFIX = 'GAME LOBBY:';
export const BTN_LEAVE_LOBBY = 'LEAVE LOBBY';
export const BTN_START_GAME = 'START GAME';
export const BTN_STARTING_GAME = 'STARTING...';
export const LABEL_HOST_CONTROLS = 'Host controls only';
export const LABEL_WAITING_HOST = 'Waiting for host to start...';
export const LABEL_WAITING_PLAYERS = 'Waiting for more...';
export const LABEL_BLINDS = 'Blinds';
export const LABEL_MIN_BUYIN = 'Min Buy-in';
export const LABEL_FORMAT = 'Format';
export const FORMAT_NLHE = "No Limit Hold'em";
export const LABEL_TABLE_RULES = 'Table Rules';
export const LABEL_HOST = 'HOST';

// ─── Game Table ───────────────────────────────────────────────────────────────
export const BTN_LEAVE_TABLE = 'LEAVE TABLE';
export const BTN_CLAIM_WIN = 'CLAIM THE WIN';
export const BTN_CLAIMING = 'CLAIMING...';

export const BTN_FOLD = 'Fold';
export const BTN_CHECK = 'Check';
export const BTN_CALL_PREFIX = 'Call $';
export const BTN_ALL_IN_PREFIX = 'All In $';
export const BTN_BET = 'Bet';
export const BTN_RAISE = 'Raise';

export const ARIA_RAISE_AMOUNT = 'Raise amount';

export const LABEL_MAIN_POT = 'Main Pot';
export const LABEL_SIDE_POT_PREFIX = 'Side Pot';
export const LABEL_UNCALLED = 'Uncalled';

// ─── Ready Countdown ─────────────────────────────────────────────────────────
export const READY_PROMPT = 'Round complete. Confirm READY to continue.';
export const BTN_READY = 'READY';
export const BTN_READY_CONFIRMED = 'READY CONFIRMED';
export const LABEL_PLAYERS_READY_SUFFIX = 'players ready';

// ─── Showdown ─────────────────────────────────────────────────────────────────
export const SHOWDOWN_ROUND_RESULT = 'Round Result';
export const SHOWDOWN_GAME_OVER = 'Game Over';
export const SHOWDOWN_ROUND_OVER = 'Round Over';
export const SHOWDOWN_PROCESSING = 'Processing results...';
export const SHOWDOWN_TIE_PREFIX = "It's a tie: ";
export const SHOWDOWN_FORFEIT_SUFFIX = ' won by forfeit!';
export const SHOWDOWN_WIN_SUFFIX = ' won!';
export const SHOWDOWN_POT_SPLIT = 'Pot split equally';
export const SHOWDOWN_WON_WITH_PREFIX = 'Won with ';
export const SHOWDOWN_WON_ROUND = 'Won the round';
export const SHOWDOWN_SHOW_DETAILS = 'Show result details';
export const SHOWDOWN_HIDE_DETAILS = 'Hide result details';
export const SHOWDOWN_OPEN_FULL_REVIEW = 'Open full result review';
export const SHOWDOWN_CLOSE_FULL_REVIEW = 'Close full result review';
export const SHOWDOWN_FULL_REVIEW = 'Full Result Review';
export const SHOWDOWN_COMMUNITY_CARDS = 'Community cards';
export const SHOWDOWN_REVEALED_HOLE_CARDS = 'Revealed hole cards';
export const SHOWDOWN_PLAYER_OUTCOMES = 'Player outcomes';
export const SHOWDOWN_NO_REVEALED_HOLE_CARDS = 'No revealed hole cards';
export const ARIA_ROUND_RESULT = 'Round Result';

// ─── Notifications ────────────────────────────────────────────────────────────
export const HOST_LEFT = 'Host left the lobby. Returning to main lobby...';
export const GAME_FINISHED_FALLBACK = 'Game finished. Returning to lobby...';
export const FAILED_LEAVE = 'Failed to leave game safely.';
export const FAILED_START = 'Only the host can start the game.';
export const RAISE_ERROR_GENERIC = 'Enter a valid amount.';
export const RAISE_ERROR_FORBIDDEN_BET = 'That bet size is not allowed. Adjust the amount and try again.';

// ─── Raise validation ────────────────────────────────────────────────────────
export const RAISE_VALIDATION_WHOLE_NUMBER = 'Enter a whole number.';
export const RAISE_VALIDATION_POSITIVE = 'Amount must be greater than 0.';
export const RAISE_VALIDATION_BET_MIN = 'Bet amount must be at least 1 chip.';
export const RAISE_VALIDATION_MAX = 'Amount cannot exceed 10,000,000 chips.';

// ─── Error normalizer fallbacks ───────────────────────────────────────────────
export const ERROR_INVALID_FORMAT = 'Invalid request format. Please try again.';
export const ERROR_TECHNICAL = 'Technical difficulties.';
export const ERROR_SYSTEM = 'A system error occurred. Please try again.';

// ─── Waiting / Reconnect ─────────────────────────────────────────────────────
export const WAITING_RECONNECT_PREFIX = 'Waiting for ';
export const WAITING_RECONNECT_SUFFIX = ' to reconnect...';

// ─── Card placeholders ────────────────────────────────────────────────────────
export const CARD_PLACEHOLDER_TURN = 'TURN';
export const CARD_PLACEHOLDER_RIVER = 'RIVER';
