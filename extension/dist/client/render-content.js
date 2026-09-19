function renderInline(document, inline) {
    if (inline.type === 'text')
        return document.createTextNode(inline.text);
    if (inline.type === 'code') {
        const code = document.createElement('code');
        code.className = 'inline-code';
        code.textContent = inline.text;
        return code;
    }
    if (inline.type === 'math') {
        const math = document.createElement('code');
        math.className = 'inline-math';
        math.textContent = `$${inline.latex}$`;
        return math;
    }
    const element = document.createElement(inline.type === 'strong'
        ? 'strong'
        : inline.type === 'emphasis'
            ? 'em'
            : inline.type === 'strike'
                ? 's'
                : 'a');
    if (inline.type === 'link') {
        element.setAttribute('href', inline.href);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
    }
    for (const child of inline.content)
        element.append(renderInline(document, child));
    return element;
}
function appendInline(document, parent, content) {
    for (const inline of content)
        parent.append(renderInline(document, inline));
}
function copyText(document, text, button) {
    const navigator = document.defaultView?.navigator;
    if (!navigator?.clipboard?.writeText) {
        button.textContent = 'Unavailable';
        return;
    }
    button.disabled = true;
    void navigator.clipboard.writeText(text)
        .then(() => {
        button.textContent = 'Copied';
    })
        .catch(() => {
        button.textContent = 'Copy failed';
    })
        .finally(() => {
        document.defaultView?.setTimeout(() => {
            button.disabled = false;
            button.textContent = 'Copy';
        }, 1_200);
    });
}
function renderCodeBlock(document, block) {
    const shell = document.createElement('div');
    shell.className = 'code-shell';
    const header = document.createElement('div');
    header.className = 'code-header';
    const language = document.createElement('span');
    language.className = 'code-language';
    language.textContent = block.language?.trim() || 'code';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy code');
    copy.addEventListener('click', () => copyText(document, block.code, copy));
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    const code = document.createElement('code');
    if (block.language)
        code.dataset.language = block.language;
    code.textContent = block.code;
    pre.append(code);
    header.append(language, copy);
    shell.append(header, pre);
    return shell;
}
function renderTable(document, block) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    if (block.headers.length) {
        const thead = document.createElement('thead');
        const row = document.createElement('tr');
        for (const header of block.headers) {
            const cell = document.createElement('th');
            appendInline(document, cell, header);
            row.append(cell);
        }
        thead.append(row);
        table.append(thead);
    }
    const tbody = document.createElement('tbody');
    for (const rowData of block.rows) {
        const row = document.createElement('tr');
        for (const cellData of rowData) {
            const cell = document.createElement('td');
            appendInline(document, cell, cellData);
            row.append(cell);
        }
        tbody.append(row);
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
}
function renderBlock(document, block) {
    if (block.type === 'paragraph') {
        const paragraph = document.createElement('p');
        appendInline(document, paragraph, block.content);
        return paragraph;
    }
    if (block.type === 'heading') {
        const heading = document.createElement(`h${Math.min(6, Math.max(1, block.level))}`);
        appendInline(document, heading, block.content);
        return heading;
    }
    if (block.type === 'code')
        return renderCodeBlock(document, block);
    if (block.type === 'list') {
        const list = document.createElement(block.ordered ? 'ol' : 'ul');
        for (const item of block.items) {
            const li = document.createElement('li');
            appendInline(document, li, item);
            list.append(li);
        }
        return list;
    }
    if (block.type === 'blockquote') {
        const quote = document.createElement('blockquote');
        for (const child of block.blocks)
            quote.append(renderBlock(document, child));
        return quote;
    }
    if (block.type === 'table')
        return renderTable(document, block);
    if (block.type === 'math') {
        const math = document.createElement('pre');
        math.className = 'math-block';
        math.textContent = `$$\n${block.latex}\n$$`;
        return math;
    }
    const divider = document.createElement('hr');
    divider.className = 'content-divider';
    return divider;
}
export function renderSemanticDocument(document, semantic, target) {
    const fragment = document.createDocumentFragment();
    for (const block of semantic.blocks)
        fragment.append(renderBlock(document, block));
    target.replaceChildren(fragment);
}
