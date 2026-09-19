function escapeText(value) {
    return value.replace(/\\/g, '\\\\').replace(/([*_\[\]])/g, '\\$1');
}
function inlineToMarkdown(inline) {
    if (inline.type === 'text')
        return escapeText(inline.text);
    if (inline.type === 'code')
        return `\`${inline.text.replace(/`/g, '\\`')}\``;
    if (inline.type === 'math')
        return `$${inline.latex}$`;
    if (inline.type === 'link') {
        return `[${inlinesToMarkdown(inline.content)}](${inline.href.replace(/\)/g, '\\)')})`;
    }
    if (inline.type === 'strong')
        return `**${inlinesToMarkdown(inline.content)}**`;
    if (inline.type === 'emphasis')
        return `*${inlinesToMarkdown(inline.content)}*`;
    return `~~${inlinesToMarkdown(inline.content)}~~`;
}
function inlinesToMarkdown(content) {
    return content.map(inlineToMarkdown).join('');
}
function longestBacktickRun(value) {
    let longest = 0;
    for (const match of value.matchAll(/`+/g))
        longest = Math.max(longest, match[0].length);
    return longest;
}
function codeFence(code) {
    return '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
}
function tableCell(content) {
    return inlinesToMarkdown(content).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function blockToMarkdown(block) {
    if (block.type === 'paragraph')
        return inlinesToMarkdown(block.content);
    if (block.type === 'heading')
        return `${'#'.repeat(Math.min(6, Math.max(1, block.level)))} ${inlinesToMarkdown(block.content)}`;
    if (block.type === 'divider')
        return '---';
    if (block.type === 'math')
        return `$$\n${block.latex}\n$$`;
    if (block.type === 'code') {
        const fence = codeFence(block.code);
        return `${fence}${block.language ?? ''}\n${block.code}\n${fence}`;
    }
    if (block.type === 'list') {
        return block.items
            .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlinesToMarkdown(item)}`)
            .join('\n');
    }
    if (block.type === 'blockquote') {
        return block.blocks
            .map(blockToMarkdown)
            .join('\n\n')
            .split('\n')
            .map((line) => `> ${line}`.trimEnd())
            .join('\n');
    }
    const width = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
    const headers = [...block.headers];
    while (headers.length < width)
        headers.push([]);
    const headerLine = `| ${headers.map(tableCell).join(' | ')} |`;
    const divider = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
    const rows = block.rows.map((row) => {
        const cells = [...row];
        while (cells.length < width)
            cells.push([]);
        return `| ${cells.map(tableCell).join(' | ')} |`;
    });
    return [headerLine, divider, ...rows].join('\n');
}
export function semanticDocumentToMarkdown(document) {
    return document.blocks.map(blockToMarkdown).filter(Boolean).join('\n\n');
}
