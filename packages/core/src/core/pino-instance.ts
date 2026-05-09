import { pino, Logger as PinoLogger, stdSerializers } from 'pino';
import { resolveLogLevel, resolveLogFormat } from './logger.js';

let _instance: PinoLogger | null = null;

// ── Ayu Dark palette ─────────────────────────────────────────────────────────
// Reference: https://github.com/ayu-theme/ayu-colors
const R    = '\x1b[0m';
const DIM  = '\x1b[2m';
const BOLD = '\x1b[1m';

function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

// Semantic color tokens — Ayu Dark
const AYU = {
  fg:       fg(179, 177, 173), // #b3b1ad — common foreground
  muted:    fg(98,  106, 115), // #626a73 — comments / muted UI
  orange:   fg(255, 143,  64), // #ff8f40 — keyword / warn
  red:      fg(240, 113, 120), // #f07178 — parameter / error
  redBold:  fg(255,  51,  51), // #ff3333 — fatal / critical (same family, brighter)
  cyan:     fg( 57, 186, 230), // #39bae6 — tag / info accent (unused but available)
};

// ── Level config (Ayu Dark semantics) ────────────────────────────────────────
// timestamp  → muted dim    — disappears, it's context
// INFO       → fg           — neutral, doesn't shout
// DEBUG      → muted        — almost invisible
// WARN       → orange       — #ff8f40 keyword color
// ERROR      → red          — #f07178 parameter/error color
// FATAL      → red bright + bold — #ff3333
const LEVEL_FMT: Record<number, { label: string; prefix: string }> = {
  10: { label: 'TRACE', prefix: `${AYU.muted}${DIM}` },
  20: { label: 'DEBUG', prefix: AYU.muted },
  30: { label: 'INFO ', prefix: AYU.fg },
  40: { label: 'WARN ', prefix: AYU.orange },
  50: { label: 'ERROR', prefix: AYU.red },
  60: { label: 'FATAL', prefix: `${BOLD}${AYU.redBold}` },
};

// ── Time formatter ────────────────────────────────────────────────────────────
function formatTime(epoch: number): string {
  const d = new Date(epoch);
  const p = (n: number, l = 2) => n.toString().padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ── Line formatter ────────────────────────────────────────────────────────────
// [nodulus]  → fg bold     — identity, no color (Ayu common foreground)
// [app]      → muted       — user, subordinate (Ayu comment)
// [context]  → muted dim   — disappears
// message    → fg          — the protagonist
function formatPrettyLine(obj: Record<string, unknown>): string {
  const ts      = typeof obj.time === 'number' ? formatTime(obj.time) : String(obj.time ?? '');
  const level   = typeof obj.level   === 'number' ? obj.level   : 30;
  const fmt     = LEVEL_FMT[level] ?? { label: '?????', prefix: AYU.fg };
  const service = typeof obj.service === 'string' ? obj.service : '';
  const module  = typeof obj.module  === 'string' ? obj.module  : '';
  const msg     = typeof obj.msg     === 'string' ? obj.msg     : '';
  const err     = obj.err as { message?: string; stack?: string } | undefined;

  // timestamp: muted + dim — disappears, it's context
  const tsStr = `${AYU.muted}${DIM}${ts}${R}`;

  // level: styled per Ayu color table
  const lvStr = `${fmt.prefix}${fmt.label}${R}`;

  // [nodulus] = bold fg, user services = muted
  const svcStr = service === 'nodulus'
    ? ` ${BOLD}${AYU.fg}[nodulus]${R}`
    : service
      ? ` ${AYU.muted}[${service}]${R}`
      : '';

  // [module] / context: muted dim — disappears into background
  const modStr = module ? ` ${AYU.muted}${DIM}[${module}]${R}` : '';

  // message: fg — the protagonist
  const msgStr = `${AYU.fg}${msg}${R}`;

  // error stack: muted dim, indented
  const errStr = err?.stack
    ? `\n  ${AYU.muted}${DIM}${err.stack.split('\n').join('\n  ')}${R}`
    : err?.message
      ? ` ${AYU.red}— ${err.message}${R}`
      : '';

  return `${tsStr} ${lvStr}${svcStr}${modStr} ${msgStr}${errStr}`;
}

// ── Custom inline stream (replaces pino-pretty transport) ────────────────────
// This avoids the pino-pretty worker-thread approach which fails in consumer
// projects because pino-pretty is only in devDependencies of nodulus-core.
function createPrettyStream() {
  return {
    write(chunk: string) {
      try {
        const line = chunk.trim();
        if (line) {
          const obj = JSON.parse(line) as Record<string, unknown>;
          process.stdout.write(formatPrettyLine(obj) + '\n');
        }
      } catch {
        process.stdout.write(chunk);
      }
    }
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createDefaultPinoInstance(
  explicitFormat?: import('../types/index.js').LogFormat,
  explicitLevel?: import('../types/index.js').LogLevel
): PinoLogger {
  const resolvedLevel  = resolveLogLevel(explicitLevel);
  const resolvedFormat = resolveLogFormat(explicitFormat);
  const isProduction   = resolvedFormat === 'json';

  const baseOpts = {
    level: resolvedLevel,
    base: { service: 'nodulus' },
    serializers: {
      err:   stdSerializers.err,
      error: stdSerializers.err,
    },
  };

  if (isProduction) {
    return pino({
      ...baseOpts,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  return pino(baseOpts, createPrettyStream());
}

export function getPinoInstance(): PinoLogger {
  if (!_instance) {
    _instance = createDefaultPinoInstance();
  }
  return _instance;
}

export function setPinoInstance(instance: PinoLogger): void {
  _instance = instance;
}
