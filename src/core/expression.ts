/**
 * Small, safe expression language (no `eval`).
 *
 *   [Field]            field of the current row (dotted paths: [Customer.Name])
 *   ?Param             report parameter
 *   PageNumber         built-in variables (PageNumber, TotalPages, RowNumber, ReportName)
 *   'text', "text"     strings;  123, 4.5  numbers;  true / false / null
 *   + - * / %          arithmetic ('+' concatenates when either side is a string)
 *   = == != <> < <= > >=   comparison
 *   and or not  && || !    logic
 *   Fn(arg, ...)       functions, case-insensitive (see functions.ts)
 */

export type Ast =
  | { t: 'lit'; v: unknown }
  | { t: 'field'; path: string }
  | { t: 'param'; name: string }
  | { t: 'var'; name: string }
  | { t: 'call'; name: string; args: Ast[] }
  | { t: 'bin'; op: string; l: Ast; r: Ast }
  | { t: 'un'; op: string; e: Ast };

export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly source: string,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type TokType = 'num' | 'str' | 'field' | 'param' | 'ident' | 'op' | 'lp' | 'rp' | 'comma' | 'eof';
interface Token {
  type: TokType;
  value: string;
  pos: number;
}

const OPERATORS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '%', '!'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < n && /[0-9.]/.test(src[i])) i++;
      if (/[eE]/.test(src[i] ?? '') && /[-+0-9]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      tokens.push({ type: 'num', value: src.slice(start, i), pos: start });
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let s = '';
      while (i < n) {
        if (src[i] === quote) {
          if (src[i + 1] === quote) {
            s += quote;
            i += 2;
            continue;
          }
          break;
        }
        if (src[i] === '\\' && i + 1 < n) {
          const next = src[i + 1];
          s += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        s += src[i++];
      }
      if (i >= n) throw new ExpressionError('Unterminated string', start, src);
      i++;
      tokens.push({ type: 'str', value: s, pos: start });
      continue;
    }
    if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new ExpressionError('Missing ]', start, src);
      const name = src.slice(i + 1, end).trim();
      if (!name) throw new ExpressionError('Empty field reference', start, src);
      tokens.push({ type: 'field', value: name, pos: start });
      i = end + 1;
      continue;
    }
    if (ch === '?' || ch === '@') {
      i++;
      while (i < n && /[\w.]/.test(src[i])) i++;
      const name = src.slice(start + 1, i);
      if (!name) throw new ExpressionError('Expected parameter name', start, src);
      tokens.push({ type: 'param', value: name, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      while (i < n && /[\w]/.test(src[i])) i++;
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lp', value: ch, pos: i++ });
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rp', value: ch, pos: i++ });
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: i++ });
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExpressionError(`Unexpected character '${ch}'`, i, src);
  }
  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}

const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  '||': 1,
  and: 2,
  '&&': 2,
  '=': 4,
  '==': 4,
  '!=': 4,
  '<>': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};

const NORMALIZE_OP: Record<string, string> = {
  '==': '=',
  '<>': '!=',
  '||': 'or',
  '&&': 'and',
  '!': 'not',
};

class Parser {
  private p = 0;
  constructor(
    private tokens: Token[],
    private src: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.p];
  }
  private next(): Token {
    return this.tokens[this.p++];
  }
  private err(msg: string, tok = this.peek()): never {
    throw new ExpressionError(msg, tok.pos, this.src);
  }

  parse(): Ast {
    const ast = this.expr(0);
    if (this.peek().type !== 'eof') this.err(`Unexpected '${this.peek().value}'`);
    return ast;
  }

  private binaryOp(): string | null {
    const tok = this.peek();
    if (tok.type === 'op' && tok.value in BINARY_PRECEDENCE) return tok.value;
    if (tok.type === 'ident') {
      const lower = tok.value.toLowerCase();
      if (lower === 'and' || lower === 'or') return lower;
    }
    return null;
  }

  private expr(minPrec: number): Ast {
    let left = this.unary();
    for (;;) {
      const op = this.binaryOp();
      if (!op) break;
      const prec = BINARY_PRECEDENCE[op];
      if (prec < minPrec) break;
      this.next();
      const right = this.expr(prec + 1);
      left = { t: 'bin', op: NORMALIZE_OP[op] ?? op, l: left, r: right };
    }
    return left;
  }

  private unary(): Ast {
    const tok = this.peek();
    if (tok.type === 'op' && (tok.value === '-' || tok.value === '!' || tok.value === '+')) {
      this.next();
      // `not` binds looser than comparison: !a = b  ->  !(a = b)
      const operand = tok.value === '!' ? this.expr(4) : this.unary();
      if (tok.value === '+') return operand;
      return { t: 'un', op: NORMALIZE_OP[tok.value] ?? tok.value, e: operand };
    }
    if (tok.type === 'ident' && tok.value.toLowerCase() === 'not') {
      this.next();
      return { t: 'un', op: 'not', e: this.expr(4) };
    }
    return this.primary();
  }

  private primary(): Ast {
    const tok = this.next();
    switch (tok.type) {
      case 'num': {
        const v = Number(tok.value);
        if (Number.isNaN(v)) this.err(`Invalid number '${tok.value}'`, tok);
        return { t: 'lit', v };
      }
      case 'str':
        return { t: 'lit', v: tok.value };
      case 'field':
        return { t: 'field', path: tok.value };
      case 'param':
        return { t: 'param', name: tok.value };
      case 'lp': {
        const e = this.expr(0);
        if (this.next().type !== 'rp') this.err('Expected )');
        return e;
      }
      case 'ident': {
        const lower = tok.value.toLowerCase();
        if (this.peek().type === 'lp') {
          this.next();
          const args: Ast[] = [];
          if (this.peek().type !== 'rp') {
            for (;;) {
              args.push(this.expr(0));
              const sep = this.next();
              if (sep.type === 'rp') break;
              if (sep.type !== 'comma') this.err('Expected , or )', sep);
            }
          } else {
            this.next();
          }
          return { t: 'call', name: lower, args };
        }
        if (lower === 'true') return { t: 'lit', v: true };
        if (lower === 'false') return { t: 'lit', v: false };
        if (lower === 'null') return { t: 'lit', v: null };
        return { t: 'var', name: lower };
      }
      case 'eof':
        this.err('Unexpected end of expression', tok);
      // eslint-disable-next-line no-fallthrough
      default:
        this.err(`Unexpected '${tok.value}'`, tok);
    }
  }
}

const cache = new Map<string, Ast>();

/** Parse (and memoize) an expression. Throws ExpressionError. */
export function parseExpression(src: string): Ast {
  const hit = cache.get(src);
  if (hit) return hit;
  const ast = new Parser(tokenize(src), src).parse();
  if (cache.size > 2000) cache.clear();
  cache.set(src, ast);
  return ast;
}

/** Returns an error message, or null when the expression is valid. */
export function validateExpression(src: string): string | null {
  if (!src.trim()) return null;
  try {
    parseExpression(src);
    return null;
  } catch (e) {
    if (e instanceof ExpressionError) return `${e.message} (at ${e.position + 1})`;
    return String(e);
  }
}

/** Collect field paths referenced by an expression (used by designer & CSV header inference). */
export function referencedFields(src: string): string[] {
  const out = new Set<string>();
  const walk = (a: Ast) => {
    switch (a.t) {
      case 'field':
        out.add(a.path);
        break;
      case 'call':
        a.args.forEach(walk);
        break;
      case 'bin':
        walk(a.l);
        walk(a.r);
        break;
      case 'un':
        walk(a.e);
        break;
    }
  };
  try {
    walk(parseExpression(src));
  } catch {
    /* ignore */
  }
  return [...out];
}

/** True when the expression uses page-dependent variables or page-scope aggregates. */
export function isPageDependent(src: string): boolean {
  return /\b(PageNumber|TotalPages)\b/i.test(src) || /,\s*['"]page['"]\s*\)/i.test(src);
}
