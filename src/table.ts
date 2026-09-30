/*
 * TableSearch — the table widget
 *
 * Deliberately framework-free. The whole surface is a header row of label + filter box, and a
 * virtualised body; anything more would be weight that has to be shipped to every report.
 *
 * The one structural rule: filtering and sorting never rebuild the header. That is what made
 * the LineUp-based version unusable — it destroyed and recreated the header on every filter
 * change, so the input the user was typing into disappeared mid-word.
 */

import { elementScroll, observeElementOffset, observeElementRect, Virtualizer } from '@tanstack/virtual-core';
import { valueFormatter } from 'powerbi-visuals-utils-formattingutils';

export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export interface ITableColumn {
    /** Header text, from the Power BI field well. */
    label: string;
    /** Position of this column's value within a row array. */
    index: number;
    type: ColumnType;
    /** Set when the model tags this field's data category as Web URL — rendered as a link. */
    isUrl?: boolean;
    /** Set when the model tags this field's data category as Image URL — rendered as a thumbnail. */
    isImage?: boolean;
    /** The model's format string ($#,0.00, 0.00%, mm/dd/yyyy, ...), if any. */
    format?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface ICellStyle {
    /** Resolved background colour, or undefined to leave the row shading alone. */
    background?: string;
    /** Resolved font colour. */
    color?: string;
}

export interface ISortState {
    column: number;
    direction: SortDirection;
}

export interface ITableOptions {
    /** Narrowest a column may be squeezed to, whether auto-fit or dragged by hand. */
    minColumnWidth: number;
    /** Widest an auto-fit column grows to before it just ellipsizes; a user drag can still exceed it. */
    maxAutoColumnWidth: number;
    /** Quiet period after the last keystroke before a filter is applied. */
    filterDebounceMs: number;
    /** How many rows to render beyond the visible window. */
    overscan: number;
}

export const DEFAULT_TABLE_OPTIONS: ITableOptions = {
    minColumnWidth: 80,
    maxAutoColumnWidth: 320,
    filterDebounceMs: 150,
    overscan: 10,
};

/**
 * Everything the format pane controls.
 *
 * Colours and text size are pushed out as CSS custom properties, so changing them restyles the
 * table without touching the DOM. Row height is the exception: the virtualiser measures in
 * pixels and has to be told.
 */
export interface IAppearance {
    rowHeight: number;
    fontSize: number;
    alternateRows: boolean;
    showTotals: boolean;
    linkIcon: boolean;
    showSearch: boolean;
    headerBackground: string;
    textColor: string;
    gridColor: string;
    selectionColor: string;
}

export interface ITableCallbacks {
    /** Fired when the user changes the row selection, with indices into the unfiltered rows. */
    onSelectionChanged(indices: number[]): void;
    /** Right-click on a column header, e.g. to reach that column's conditional formatting. */
    onColumnContextMenu(column: number, x: number, y: number): void;
    /** Right-click on a row, with the unfiltered row index. */
    onRowContextMenu(row: number, x: number, y: number): void;
    /** Pointer over a row, with every column's label/value for the default tooltip. */
    onRowHover(row: number, items: { displayName: string; value: string }[], x: number, y: number): void;
    /** Pointer left the body, or left every row within it. */
    onRowHoverEnd(): void;
}

type Row = unknown[];

/** Mirrors `@font-stack` in style.less, so canvas text measurement matches what's on screen. */
const FONT_STACK = '"Segoe UI", "wf_segoe-ui_normal", helvetica, arial, sans-serif';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Feather/Lucide "link" glyph — used when a Web URL column is shown as an icon instead of text. */
function createLinkIcon(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    [
        'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
        'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    ].forEach((d) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });

    return svg;
}

function debounce(fn: () => void, wait: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn();
        }, wait);
    };
}

/** Display text for a cell that has no format string to honour, or isn't a number/date. */
function formatValue(value: unknown, type: ColumnType): string {
    if (value === null || value === undefined || value === '') {
        return '';
    }
    switch (type) {
        case 'number': {
            const n = Number(value);
            return isNaN(n) ? String(value) : n.toLocaleString();
        }
        case 'date': {
            const d = value instanceof Date ? value : new Date(String(value));
            return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
        }
        case 'boolean':
            return value ? 'True' : 'False';
        default:
            return String(value);
    }
}

/** Comparable form of a cell, so sorting a numeric column does not compare it as text. */
function sortKey(value: unknown, type: ColumnType): number | string {
    if (value === null || value === undefined) {
        return type === 'number' || type === 'date' ? Number.NEGATIVE_INFINITY : '';
    }
    if (type === 'number') {
        const n = Number(value);
        return isNaN(n) ? Number.NEGATIVE_INFINITY : n;
    }
    if (type === 'date') {
        const d = value instanceof Date ? value : new Date(String(value));
        return isNaN(d.getTime()) ? Number.NEGATIVE_INFINITY : d.getTime();
    }
    if (type === 'boolean') {
        return value ? 1 : 0;
    }
    return String(value).toLowerCase();
}

export class SearchTable {
    private readonly options: ITableOptions;
    private readonly callbacks: ITableCallbacks;

    private readonly root: HTMLElement;
    private readonly head: HTMLElement;
    private readonly headRow: HTMLElement;
    private readonly body: HTMLElement;
    private readonly spacer: HTMLElement;
    private readonly foot: HTMLElement;
    private readonly footRow: HTMLElement;

    private columns: ITableColumn[] = [];
    private rows: Row[] = [];

    /** Display order, as positions into `columns`. Reset to identity whenever the column set changes. */
    private order: number[] = [];
    /** Column index (into `columns`) currently being dragged, while a header drag is in progress. */
    private dragColumn: number | null = null;

    /**
     * Conditional-formatting colours, indexed [row index][column position] to match `columns`
     * rather than the raw row arrays. `null` throughout means nothing is formatted, which is the
     * common case and skips the lookup entirely.
     */
    private cellStyles: (ICellStyle | null)[][] | null = null;

    /** Filter text per column index, lower-cased. Absent or '' means no filter on that column. */
    private readonly filters = new Map<number, string>();
    private sort: ISortState | null = null;

    /** Indices into `rows`, after filtering and sorting. The body renders this. */
    private view: number[] = [];

    /** Selected indices into `rows`. */
    private selected = new Set<number>();

    /** Row index (into `rows`) that keyboard navigation is currently on, if any. */
    private focusedRow: number | null = null;

    private readonly filterInputs = new Map<number, HTMLInputElement>();
    private readonly sortIndicators = new Map<number, HTMLElement>();

    private virtualizer: Virtualizer<HTMLElement, HTMLElement> | null = null;
    private unmountVirtualizer: (() => void) | null = null;

    /** Natural (auto-fit, or user-dragged) column widths, indexed to match `columns`. */
    private columnWidths: number[] = [];
    /** What's actually applied to the DOM: `columnWidths`, with any leftover container width
     *  stretched across the non-manual columns. Kept separate so a resize doesn't compound. */
    private renderWidths: number[] = [];
    /** User-dragged widths that survive a data refresh, keyed by column label. */
    private readonly manualWidths = new Map<string, number>();
    private measureCtx: CanvasRenderingContext2D | null = null;

    private rowHeight = 24;
    private alternateRows = false;
    private showTotals = false;
    private linkIcon = false;

    private locale = 'en-US';
    /** One formatter per column, built lazily and keyed by column identity so it's invalidated
     *  automatically whenever `buildHeader` replaces `columns`. */
    private readonly formatters = new WeakMap<ITableColumn, valueFormatter.IValueFormatter>();

    constructor(container: HTMLElement, callbacks: ITableCallbacks, options?: Partial<ITableOptions>) {
        this.options = { ...DEFAULT_TABLE_OPTIONS, ...options };
        this.callbacks = callbacks;

        this.root = document.createElement('div');
        this.root.className = 'ts-root';

        this.head = document.createElement('div');
        this.head.className = 'ts-head';
        this.headRow = document.createElement('div');
        this.headRow.className = 'ts-head-row';
        this.head.appendChild(this.headRow);

        this.body = document.createElement('div');
        this.body.className = 'ts-body';
        this.body.tabIndex = 0;
        this.body.setAttribute('role', 'grid');
        this.body.setAttribute('aria-label', 'Table rows; use arrow keys to move, Enter to select');
        this.spacer = document.createElement('div');
        this.spacer.className = 'ts-spacer';
        this.body.appendChild(this.spacer);

        this.foot = document.createElement('div');
        this.foot.className = 'ts-foot';
        this.foot.hidden = true;
        this.footRow = document.createElement('div');
        this.footRow.className = 'ts-foot-row';
        this.foot.appendChild(this.footRow);

        this.root.appendChild(this.head);
        this.root.appendChild(this.body);
        this.root.appendChild(this.foot);
        container.appendChild(this.root);

        // The header and totals row sit outside the scroll container so they stay put vertically;
        // they have to be dragged along horizontally by hand.
        this.body.addEventListener('scroll', () => {
            this.head.scrollLeft = this.body.scrollLeft;
            this.foot.scrollLeft = this.body.scrollLeft;
        });

        this.body.addEventListener('click', (evt) => this.onBodyClick(evt));
        this.body.addEventListener('contextmenu', (evt) => this.onBodyContextMenu(evt));
        this.body.addEventListener('pointermove', (evt) => this.onBodyPointerMove(evt));
        this.body.addEventListener('pointerleave', () => this.callbacks.onRowHoverEnd());
        this.body.addEventListener('keydown', (evt) => this.onBodyKeyDown(evt));
    }

    /** The report's locale, for number/date format strings. Set once; does not change per update. */
    public setLocale(locale: string): void {
        this.locale = locale;
    }

    /**
     * Replaces the data.
     *
     * Filters are keyed by column index and survive a row-only refresh, which is what makes the
     * table usable while a slicer elsewhere on the page is being adjusted.
     */
    public setData(
        columns: ITableColumn[],
        rows: Row[],
        cellStyles?: (ICellStyle | null)[][] | null
    ): void {
        const columnsChanged =
            columns.length !== this.columns.length ||
            columns.some((c, i) => this.columns[i].label !== c.label || this.columns[i].type !== c.type);

        this.columns = columns;
        this.rows = rows;
        this.cellStyles = cellStyles || null;

        if (columnsChanged) {
            this.filters.clear();
            if (this.sort && this.sort.column >= columns.length) {
                this.sort = null;
            }
            this.order = columns.map((_, i) => i);
            this.buildHeader();
        }

        this.refreshView();
    }

    /** Applies the format pane's settings. */
    public setAppearance(appearance: IAppearance): void {
        const style = this.root.style;
        style.setProperty('--ts-font-size', `${appearance.fontSize}px`);
        style.setProperty('--ts-header-bg', appearance.headerBackground);
        style.setProperty('--ts-text', appearance.textColor);
        style.setProperty('--ts-grid', appearance.gridColor);
        style.setProperty('--ts-selected', appearance.selectionColor);

        this.root.classList.toggle('ts-no-search', !appearance.showSearch);
        this.alternateRows = appearance.alternateRows;
        this.showTotals = appearance.showTotals;
        const linkIconChanged = appearance.linkIcon !== this.linkIcon;
        this.linkIcon = appearance.linkIcon;
        this.foot.hidden = !this.showTotals;

        const rowHeight = Math.max(12, Math.round(appearance.rowHeight));
        const heightChanged = rowHeight !== this.rowHeight;
        this.rowHeight = rowHeight;

        if ((linkIconChanged || heightChanged) && this.columns.length > 0) {
            // Auto-fit columns need to be re-measured: an icon takes far less room than the URL
            // text it replaces (or vice versa), and an image column's width tracks row height.
            // A column the user has resized by hand is untouched.
            this.computeColumnWidths();
            this.applyColumnWidths();
        }

        if (heightChanged) {
            // The virtualiser caches measurements against the old height, so it has to be told
            // before the next paint.
            this.syncVirtualizer();
        }
        this.renderBody();
        this.renderTotals();
    }

    /** Applies the sort coming from Power BI's own field-well sort state. */
    public setSort(sort: ISortState | null): void {
        this.sort = sort;
        this.updateSortIndicators();
        this.refreshView();
    }

    /** Mirrors a selection made elsewhere in the report, without echoing it back out. */
    public setSelection(indices: number[]): void {
        const next = new Set(indices);
        if (next.size === this.selected.size && indices.every((i) => this.selected.has(i))) {
            return;
        }
        this.selected = next;
        this.renderBody();
    }

    public layout(): void {
        this.applyColumnWidths();
        this.renderBody();
    }

    public destroy(): void {
        if (this.unmountVirtualizer) {
            this.unmountVirtualizer();
            this.unmountVirtualizer = null;
        }
        this.virtualizer = null;
        this.filterInputs.clear();
        this.sortIndicators.clear();
        this.root.remove();
    }

    private buildHeader(): void {
        this.headRow.textContent = '';
        this.filterInputs.clear();
        this.sortIndicators.clear();

        this.order.forEach((i) => {
            const column = this.columns[i];
            const th = document.createElement('div');
            th.className = 'ts-th';
            th.dataset.columnIndex = String(i);

            const label = document.createElement('div');
            label.className = 'ts-th-label';
            label.title = `${column.label} — click to sort, drag to reorder`;
            label.draggable = true;
            label.tabIndex = 0;
            label.setAttribute('role', 'button');
            label.setAttribute('aria-label', `Sort by ${column.label}`);

            const text = document.createElement('span');
            text.className = 'ts-th-text';
            text.textContent = column.label;
            label.appendChild(text);

            const indicator = document.createElement('span');
            indicator.className = 'ts-th-sort';
            label.appendChild(indicator);
            this.sortIndicators.set(i, indicator);

            label.addEventListener('click', () => this.toggleSort(i));
            label.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter' || evt.key === ' ') {
                    evt.preventDefault();
                    this.toggleSort(i);
                }
            });
            label.addEventListener('dragstart', (evt) => {
                this.dragColumn = i;
                th.classList.add('ts-dragging');
                if (evt.dataTransfer) {
                    evt.dataTransfer.effectAllowed = 'move';
                    evt.dataTransfer.setData('text/plain', String(i));
                }
            });
            label.addEventListener('dragend', () => {
                th.classList.remove('ts-dragging');
                this.dragColumn = null;
            });

            th.addEventListener('dragover', (evt) => {
                if (this.dragColumn === null || this.dragColumn === i) {
                    return;
                }
                evt.preventDefault();
                if (evt.dataTransfer) {
                    evt.dataTransfer.dropEffect = 'move';
                }
                th.classList.add('ts-drop-target');
            });
            th.addEventListener('dragleave', () => th.classList.remove('ts-drop-target'));
            th.addEventListener('drop', (evt) => {
                evt.preventDefault();
                th.classList.remove('ts-drop-target');
                if (this.dragColumn !== null && this.dragColumn !== i) {
                    this.moveColumn(this.dragColumn, i);
                }
            });
            th.addEventListener('contextmenu', (evt) => {
                evt.preventDefault();
                this.callbacks.onColumnContextMenu(i, evt.clientX, evt.clientY);
            });

            const filter = document.createElement('input');
            filter.type = 'text';
            filter.className = 'ts-th-filter';
            filter.placeholder = `Filter ${column.label}...`;
            filter.setAttribute('aria-label', `Filter ${column.label}`);

            const apply = () => {
                const value = filter.value.trim().toLowerCase();
                if (value) {
                    this.filters.set(i, value);
                } else {
                    this.filters.delete(i);
                }
                this.refreshView();
            };
            filter.addEventListener('input', debounce(apply, this.options.filterDebounceMs));
            // Enter should not submit anything, just apply immediately.
            filter.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    apply();
                }
            });

            this.filterInputs.set(i, filter);

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'ts-th-resize';
            resizeHandle.title = 'Drag to resize, double-click to auto-fit';
            resizeHandle.setAttribute('aria-hidden', 'true');
            resizeHandle.addEventListener('pointerdown', (evt) => this.startResize(evt, i));
            resizeHandle.addEventListener('dblclick', (evt) => {
                evt.stopPropagation();
                this.manualWidths.delete(column.label);
                this.columnWidths[i] = this.measureColumnWidth(i);
                this.applyColumnWidths();
                this.renderBody();
                this.renderTotals();
            });

            th.appendChild(label);
            th.appendChild(filter);
            th.appendChild(resizeHandle);
            this.headRow.appendChild(th);
        });

        this.updateSortIndicators();
        this.computeColumnWidths();
        this.applyColumnWidths();
    }

    /**
     * Recomputes every column's width: a user-dragged width if there is one (keyed by label, so
     * it survives a data refresh), else an auto-fit width from the header label and a sample of
     * that column's values. Called only when the column set actually changes — width doesn't
     * depend on the container, so a resize never needs to redo this.
     */
    private computeColumnWidths(): void {
        this.columnWidths = this.columns.map((column, i) => {
            const manual = this.manualWidths.get(column.label);
            return manual !== undefined ? manual : this.measureColumnWidth(i);
        });
    }

    /** Auto-fit width for one column: the widest of its header label and a sample of its values. */
    private measureColumnWidth(position: number): number {
        const column = this.columns[position];
        const { minColumnWidth, maxAutoColumnWidth } = this.options;

        // Nothing but a small icon is shown, whatever the underlying value looks like.
        if (column.isUrl && this.linkIcon) {
            return minColumnWidth;
        }
        if (column.isImage) {
            return Math.max(minColumnWidth, Math.round(this.rowHeight * 1.6));
        }

        const ctx = this.getMeasureCtx();
        const fontSize = parseFloat(getComputedStyle(this.root).fontSize) || 12;

        ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
        // Padding, drag handle and the sort arrow's reserved space, roughly.
        let widest = ctx.measureText(column.label).width + 44;

        ctx.font = `${fontSize}px ${FONT_STACK}`;
        const sampleSize = Math.min(this.rows.length, 200);
        for (let r = 0; r < sampleSize; r++) {
            const text = this.formatCell(this.rows[r][column.index], column);
            const width = ctx.measureText(text).width + 16;
            if (width > widest) {
                widest = width;
            }
        }

        return Math.min(maxAutoColumnWidth, Math.max(minColumnWidth, Math.ceil(widest)));
    }

    private getMeasureCtx(): CanvasRenderingContext2D {
        if (!this.measureCtx) {
            this.measureCtx = document.createElement('canvas').getContext('2d')!;
        }
        return this.measureCtx;
    }

    /**
     * Applies `columnWidths` to the DOM — cheap, safe to call on every resize. When the natural
     * widths don't fill the container, the leftover space is stretched across the non-manual
     * columns (proportionally to their own width) so the table doesn't leave a bare gap; a column
     * the user has dragged stays exactly the size they set.
     */
    private applyColumnWidths(): void {
        if (this.columns.length === 0) {
            return;
        }

        const available = this.body.clientWidth || this.root.clientWidth;
        const natural = this.columnWidths.reduce((sum, w) => sum + w, 0);
        const extra = available - natural;

        if (extra > 0) {
            const stretchable = this.columns
                .map((column, i) => (this.manualWidths.has(column.label) ? -1 : i))
                .filter((i) => i >= 0);
            const stretchableWidth = stretchable.reduce((sum, i) => sum + this.columnWidths[i], 0);

            this.renderWidths = this.columnWidths.map((width, i) => {
                if (stretchableWidth === 0 || !stretchable.includes(i)) {
                    return width;
                }
                return width + Math.floor((width / stretchableWidth) * extra);
            });
        } else {
            this.renderWidths = this.columnWidths.slice();
        }

        const total = this.renderWidths.reduce((sum, w) => sum + w, 0);
        this.headRow.style.width = `${total}px`;
        this.spacer.style.width = `${total}px`;
        this.footRow.style.width = `${total}px`;

        Array.from(this.headRow.children).forEach((th) => {
            const position = Number((th as HTMLElement).dataset.columnIndex);
            (th as HTMLElement).style.width = `${this.renderWidths[position]}px`;
        });
        Array.from(this.footRow.children).forEach((td) => {
            const position = Number((td as HTMLElement).dataset.columnIndex);
            (td as HTMLElement).style.width = `${this.renderWidths[position]}px`;
        });
    }

    /** Drags column `position`'s right edge to resize it, persisting the width by label. */
    private startResize(evt: PointerEvent, position: number): void {
        evt.preventDefault();
        evt.stopPropagation();

        const handle = evt.currentTarget as HTMLElement;
        handle.setPointerCapture(evt.pointerId);

        const startX = evt.clientX;
        // Start from what's on screen, which may be stretched wider than the natural width.
        const startWidth = this.renderWidths[position] ?? this.columnWidths[position];

        const onMove = (moveEvt: PointerEvent) => {
            const width = Math.max(this.options.minColumnWidth, startWidth + (moveEvt.clientX - startX));
            this.columnWidths[position] = width;
            this.manualWidths.set(this.columns[position].label, width);
            this.applyColumnWidths();
            this.renderBody();
            this.renderTotals();
        };
        const onUp = (upEvt: PointerEvent) => {
            handle.releasePointerCapture(upEvt.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    }

    /** Moves column `source` to sit where `target` currently is, and repaints. */
    private moveColumn(source: number, target: number): void {
        const from = this.order.indexOf(source);
        const to = this.order.indexOf(target);
        if (from < 0 || to < 0 || from === to) {
            return;
        }
        this.order.splice(from, 1);
        this.order.splice(to, 0, source);
        this.buildHeader();
        this.renderBody();
        this.renderTotals();
    }

    private toggleSort(column: number): void {
        if (!this.sort || this.sort.column !== column) {
            this.sort = { column, direction: 'asc' };
        } else if (this.sort.direction === 'asc') {
            this.sort = { column, direction: 'desc' };
        } else {
            this.sort = null;
        }
        this.updateSortIndicators();
        this.refreshView();
    }

    private updateSortIndicators(): void {
        this.sortIndicators.forEach((indicator, i) => {
            const active = this.sort && this.sort.column === i;
            indicator.textContent = active ? (this.sort!.direction === 'asc' ? '▲' : '▼') : '';
            indicator.parentElement!.classList.toggle('ts-sorted', !!active);
        });
    }

    /** Display text for a cell, honouring the column's format string for numbers and dates. */
    private formatCell(value: unknown, column: ITableColumn): string {
        if (value === null || value === undefined || value === '') {
            return '';
        }
        if (column.type === 'number') {
            const n = Number(value);
            return isNaN(n) ? String(value) : this.formatterFor(column).format(n);
        }
        if (column.type === 'date') {
            const d = value instanceof Date ? value : new Date(String(value));
            return isNaN(d.getTime()) ? String(value) : this.formatterFor(column).format(d);
        }
        return formatValue(value, column.type);
    }

    /** One formatter per column, built from its format string (or a sensible default). */
    private formatterFor(column: ITableColumn): valueFormatter.IValueFormatter {
        let formatter = this.formatters.get(column);
        if (!formatter) {
            formatter = valueFormatter.create({ format: column.format, cultureSelector: this.locale });
            this.formatters.set(column, formatter);
        }
        return formatter;
    }

    /** Recomputes which rows are shown, in what order, then repaints the body. */
    private refreshView(): void {
        const columnsByIndex = this.columns;
        const active: { position: number; needle: string; column: ITableColumn }[] = [];
        this.filters.forEach((needle, i) => {
            const column = columnsByIndex[i];
            if (column) {
                active.push({ position: column.index, needle, column });
            }
        });

        const view: number[] = [];
        for (let r = 0; r < this.rows.length; r++) {
            const row = this.rows[r];
            let keep = true;
            for (let f = 0; f < active.length; f++) {
                const { position, needle, column } = active[f];
                const text = this.formatCell(row[position], column).toLowerCase();
                if (text.indexOf(needle) < 0) {
                    keep = false;
                    break;
                }
            }
            if (keep) {
                view.push(r);
            }
        }

        if (this.sort) {
            const column = columnsByIndex[this.sort.column];
            if (column) {
                const sign = this.sort.direction === 'asc' ? 1 : -1;
                const { index: position, type } = column;
                view.sort((a, b) => {
                    const ka = sortKey(this.rows[a][position], type);
                    const kb = sortKey(this.rows[b][position], type);
                    if (ka < kb) {
                        return -sign;
                    }
                    if (ka > kb) {
                        return sign;
                    }
                    return a - b;
                });
            }
        }

        this.view = view;
        this.syncVirtualizer();
        this.renderBody();
        this.renderTotals();
    }

    /** Sum of each numeric column over the current (filtered) view, in a row below the body. */
    private renderTotals(): void {
        this.footRow.textContent = '';
        if (!this.showTotals || this.columns.length === 0) {
            this.foot.hidden = true;
            return;
        }
        this.foot.hidden = false;

        let labelPlaced = false;
        this.order.forEach((position) => {
            const column = this.columns[position];
            const cell = document.createElement('div');
            cell.className = 'ts-foot-cell';
            cell.dataset.columnIndex = String(position);
            cell.style.width = `${this.renderWidths[position]}px`;

            if (column.type === 'number') {
                let sum = 0;
                for (let v = 0; v < this.view.length; v++) {
                    const n = Number(this.rows[this.view[v]][column.index]);
                    if (!isNaN(n)) {
                        sum += n;
                    }
                }
                const text = this.formatterFor(column).format(sum);
                cell.textContent = text;
                cell.title = text;
            } else if (!labelPlaced) {
                cell.textContent = 'Total';
                labelPlaced = true;
            }

            this.footRow.appendChild(cell);
        });
    }

    private syncVirtualizer(): void {
        const opts = {
            count: this.view.length,
            getScrollElement: () => this.body,
            estimateSize: () => this.rowHeight,
            overscan: this.options.overscan,
            scrollToFn: elementScroll,
            observeElementRect,
            observeElementOffset,
            onChange: () => this.renderBody(),
        };

        if (!this.virtualizer) {
            this.virtualizer = new Virtualizer<HTMLElement, HTMLElement>(opts);
            this.unmountVirtualizer = this.virtualizer._didMount();
        } else {
            this.virtualizer.setOptions(opts);
        }
        this.virtualizer._willUpdate();
    }

    /**
     * Repaints the visible window.
     *
     * Rows are rebuilt rather than diffed: the window is a few dozen elements, so this is
     * cheaper than tracking what changed, and it keeps the code honest.
     */
    private renderBody(): void {
        if (!this.virtualizer) {
            return;
        }

        this.spacer.style.height = `${this.virtualizer.getTotalSize()}px`;
        this.spacer.textContent = '';

        if (this.view.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ts-empty';
            empty.textContent = this.rows.length === 0 ? 'No data' : 'No rows match the filters';
            this.spacer.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();

        this.virtualizer.getVirtualItems().forEach((item) => {
            const rowIndex = this.view[item.index];
            const row = this.rows[rowIndex];
            if (!row) {
                return;
            }

            const tr = document.createElement('div');
            tr.className = 'ts-row';
            if (this.alternateRows && item.index % 2 === 1) {
                tr.classList.add('ts-alt');
            }
            tr.dataset.row = String(rowIndex);
            tr.style.height = `${item.size}px`;
            tr.style.transform = `translateY(${item.start}px)`;
            if (this.selected.has(rowIndex)) {
                tr.classList.add('ts-selected');
            }
            if (this.focusedRow === rowIndex) {
                tr.classList.add('ts-focused');
            }

            this.order.forEach((position) => {
                const column = this.columns[position];
                const td = document.createElement("div");
                td.className = "ts-cell";
                const style = this.cellStyles && this.cellStyles[rowIndex] && this.cellStyles[rowIndex][position];
                if (style) {
                    if (style.background) {
                        td.style.backgroundColor = style.background;
                    }
                    if (style.color) {
                        td.style.color = style.color;
                    }
                }
                td.style.width = `${this.renderWidths[position]}px`;
                const text = this.formatCell(row[column.index], column);
                if (text === '') {
                    td.classList.add('ts-missing');
                } else if (column.isImage) {
                    const img = document.createElement('img');
                    img.className = 'ts-image';
                    img.src = text;
                    img.alt = column.label;
                    img.style.maxHeight = `${Math.max(1, this.rowHeight - 4)}px`;
                    td.appendChild(img);
                } else if (column.isUrl) {
                    const link = document.createElement('a');
                    link.className = 'ts-link';
                    link.href = text;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.title = text;
                    link.setAttribute('aria-label', text);
                    if (this.linkIcon) {
                        link.classList.add('ts-link-icon');
                        link.appendChild(createLinkIcon());
                    } else {
                        link.textContent = text;
                    }
                    // Opening the link is not a row selection; stop it there.
                    link.addEventListener('click', (evt) => evt.stopPropagation());
                    td.appendChild(link);
                } else {
                    td.textContent = text;
                    td.title = text;
                }
                tr.appendChild(td);
            });

            fragment.appendChild(tr);
        });

        this.spacer.appendChild(fragment);
    }

    private onBodyClick(evt: MouseEvent): void {
        const target = (evt.target as HTMLElement).closest('.ts-row') as HTMLElement | null;
        if (!target) {
            // A click on empty space below the rows clears the selection, matching how the
            // native Power BI table behaves.
            if (this.selected.size > 0) {
                this.selected.clear();
                this.renderBody();
                this.callbacks.onSelectionChanged([]);
            }
            return;
        }

        const rowIndex = Number(target.dataset.row);
        this.focusedRow = rowIndex;
        this.selectRow(rowIndex, evt.ctrlKey || evt.metaKey);
    }

    /** Selects `rowIndex`, toggling it into the set when `additive`, else replacing the selection. */
    private selectRow(rowIndex: number, additive: boolean): void {
        if (additive) {
            if (this.selected.has(rowIndex)) {
                this.selected.delete(rowIndex);
            } else {
                this.selected.add(rowIndex);
            }
        } else if (this.selected.size === 1 && this.selected.has(rowIndex)) {
            // Selecting the only selected row again clears it.
            this.selected.clear();
        } else {
            this.selected = new Set([rowIndex]);
        }

        this.renderBody();
        this.callbacks.onSelectionChanged(Array.from(this.selected));
    }

    private onBodyContextMenu(evt: MouseEvent): void {
        const target = (evt.target as HTMLElement).closest('.ts-row') as HTMLElement | null;
        evt.preventDefault();
        if (!target) {
            return;
        }
        this.callbacks.onRowContextMenu(Number(target.dataset.row), evt.clientX, evt.clientY);
    }

    private onBodyPointerMove(evt: PointerEvent): void {
        const target = (evt.target as HTMLElement).closest('.ts-row') as HTMLElement | null;
        if (!target) {
            this.callbacks.onRowHoverEnd();
            return;
        }

        const rowIndex = Number(target.dataset.row);
        const row = this.rows[rowIndex];
        if (!row) {
            return;
        }

        const items = this.columns.map((column) => ({
            displayName: column.label,
            value: this.formatCell(row[column.index], column) || '—',
        }));
        this.callbacks.onRowHover(rowIndex, items, evt.clientX, evt.clientY);
    }

    /** Arrow keys move a focus ring through `view`; Enter/Space selects the focused row. */
    private onBodyKeyDown(evt: KeyboardEvent): void {
        if (this.view.length === 0) {
            return;
        }

        const current = this.focusedRow === null ? -1 : this.view.indexOf(this.focusedRow);

        switch (evt.key) {
            case 'ArrowDown':
                evt.preventDefault();
                this.focusRow(Math.min(this.view.length - 1, current + 1));
                break;
            case 'ArrowUp':
                evt.preventDefault();
                this.focusRow(Math.max(0, current - 1));
                break;
            case 'Home':
                evt.preventDefault();
                this.focusRow(0);
                break;
            case 'End':
                evt.preventDefault();
                this.focusRow(this.view.length - 1);
                break;
            case 'Enter':
            case ' ':
                if (this.focusedRow !== null) {
                    evt.preventDefault();
                    this.selectRow(this.focusedRow, evt.ctrlKey || evt.metaKey);
                }
                break;
            default:
                break;
        }
    }

    /** Moves the keyboard focus ring to position `viewIndex` in `view`, scrolling it into sight. */
    private focusRow(viewIndex: number): void {
        this.focusedRow = this.view[viewIndex];
        this.virtualizer?.scrollToIndex(viewIndex, { align: 'auto' });
        this.renderBody();
    }
}
