/**
 * Reasoning Translate - Pure Text Utilities
 * 负责句子切分、语言嗅探、代码块遮蔽与清洗
 */
const ABBREVIATIONS = new Set([
    'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'approx', 'resp', 'fig', 'no', 'nos',
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'inc', 'ltd', 'co', 'corp', 'dept',
    'est', 'min', 'max', 'avg', 'std', 'ref', 'eq', 'sec', 'ch', 'vol', 'pp',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);
function isDigit(ch) {
    return ch >= '0' && ch <= '9';
}
function isLower(ch) {
    return ch >= 'a' && ch <= 'z';
}
function isUpper(ch) {
    return ch >= 'A' && ch <= 'Z';
}
function wordBefore(text, index) {
    let i = index;
    while (i > 0) {
        const ch = text[i - 1];
        if (isLower(ch) || isDigit(ch) || ch === '.')
            i -= 1;
        else
            break;
    }
    return text.slice(i, index).toLowerCase();
}
function isInitial(text, index) {
    if (!isUpper(text[index - 1] ?? ''))
        return false;
    const before = text[index - 2];
    if (!(before === undefined || /[\s([{"'`*_>|-]/.test(before)))
        return false;
    const next = text[index + 1];
    if (next === undefined)
        return true;
    if (next === ' ' || next === '\t')
        return isUpper(text[index + 2] ?? '');
    return false;
}
export function isSentenceEnd(text, index) {
    const ch = text[index];
    if (ch !== '.' && ch !== '!' && ch !== '?')
        return false;
    let j = index + 1;
    while (j < text.length && (text[j] === '"' || text[j] === "'" || text[j] === ')' || text[j] === ']' || text[j] === '`')) {
        j += 1;
    }
    if (ch === '.') {
        if (isDigit(text[index - 1] ?? '') && isDigit(text[j] ?? ''))
            return false;
        if (isInitial(text, index))
            return false;
        const word = wordBefore(text, index);
        if (ABBREVIATIONS.has(word))
            return false;
        if (word.length === 1 && !isDigit(word))
            return false;
    }
    const next = text[j];
    if (next === undefined)
        return true;
    if (!/\s/.test(next))
        return true;
    let k = j;
    while (k < text.length && /\s/.test(text[k]))
        k += 1;
    const after = text[k];
    if (after === undefined)
        return false;
    return !isLower(after);
}
export function maskCode(text) {
    const chars = [...text];
    const blank = (from, to) => {
        for (let i = from; i < to && i < chars.length; i += 1) {
            if (chars[i] !== '\n')
                chars[i] = ' ';
        }
    };
    const fence = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
    let match;
    while ((match = fence.exec(text)) !== null)
        blank(match.index, match.index + match[0].length);
    const inline = /`[^`\n]*`/g;
    while ((match = inline.exec(text)) !== null)
        blank(match.index, match.index + match[0].length);
    const url = /https?:\/\/[^\s)]+/g;
    while ((match = url.exec(text)) !== null)
        blank(match.index, match.index + match[0].length);
    return chars.join('');
}
export function splitUnits(text, options = {}) {
    const minLength = Number.isFinite(options.minLength) ? options.minLength : 1;
    const masked = maskCode(text);
    const units = [];
    let start = 0;
    for (let i = 0; i < masked.length; i += 1) {
        if (!isSentenceEnd(masked, i))
            continue;
        let end = i + 1;
        while (end < masked.length && (masked[end] === '"' || masked[end] === "'" || masked[end] === ')' || masked[end] === ']' || masked[end] === '`')) {
            end += 1;
        }
        const chunk = text.slice(start, end).replace(/^\s+/, '').replace(/\s+$/, '');
        start = end;
        if (chunk.trim() === '')
            continue;
        if (chunk.length < minLength && end < masked.length) {
            continue;
        }
        units.push(chunk);
    }
    const tail = text.slice(start).replace(/^\s+/, '').replace(/\s+$/, '');
    const complete = units.filter((unit) => unit.trim() !== '');
    return { complete, tail: tail.trim() === '' ? '' : tail, tailStart: start };
}
export function cjkCount(text) {
    let count = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0);
        if (!code)
            continue;
        if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff))
            count += 1;
    }
    return count;
}
export function looksChinese(text, minRatio = 0.35) {
    const stripped = text.replace(/\s+/g, '');
    if (stripped.length === 0)
        return false;
    return cjkCount(stripped) / stripped.length >= minRatio;
}
export function sanitizeTranslation(value, source) {
    if (typeof value !== 'string')
        return null;
    let text = value.trim();
    if (text === '')
        return null;
    const fenced = /^```[a-zA-Z-]*\n([\s\S]*?)\n?```$/.exec(text);
    if (fenced !== null)
        text = fenced[1].trim();
    if (text === '')
        return null;
    if (text === source.trim())
        return null;
    text = text.replace(/^(原文|译文|翻译|translation)\s*[:：]\s*/i, '').trim();
    if (text === '')
        return null;
    return text;
}
export function joinTranslations(fragments) {
    const out = [];
    for (const fragment of fragments) {
        if (typeof fragment !== 'string')
            continue;
        const text = fragment.replace(/\s+$/u, '');
        if (text.trim() === '')
            continue;
        out.push(text);
    }
    return out.join('\n');
}
//# sourceMappingURL=text.util.js.map