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

export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export interface ITableColumn {
    /** Header text, from the Power BI field well. */
    label: string;
    /** Position of this column's value within a row array. */
    index: number;
    type: ColumnType;
}

export type SortDirection = 'asc' | 'desc';

export interface ISortState {
    column: number;
    direction: SortDirection;
}

export interface ITableOptions {
    /** Narrowest a column may be squeezed to before the table scrolls horizontally. */
    minColumnWidth: number;
    /** Quiet period after the last keystroke before a filter is applied. */
    filterDebounceMs: number;
    /** How many rows to render beyond the visible window. */
    overscan: number;
}

export const DEFAULT_TABLE_OPTIONS: ITableOptions = {
    minColumnWidth: 120,
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
    showSearch: boolean;
    headerBackground: string;
    textColor: string;
    gridColor: string;
    selectionColor: string;
}

export interface ITableCallbacks {
    /** Fired when the user changes the row selection, with indices into the unfiltered rows. */
    onSelectionChanged(indices: number[]): void;
}

type Row = unknown[];

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

/** Display text for a cell. Empty string for a blank, which then renders as the missing dash. */
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

    private columns: ITableColumn[] = [];
    private rows: Row[] = [];

    /** Filter text per column index, lower-cased. Absent or '' means no filter on that column. */
    private readonly filters = new Map<number, string>();
    private sort: ISortState | null = null;

    /** Indices into `rows`, after filtering and sorting. The body renders this. */
    private view: number[] = [];

    /** Selected indices into `rows`. */
    private selected = new Set<number>();

    private readonly filterInputs = new Map<number, HTMLInputElement>();
    private readonly sortIndicators = new Map<number, HTMLElement>();

    private virtualizer: Virtualizer<HTMLElement, HTMLElement> | null = null;
    private unmountVirtualizer: (() => void) | null = null;

    private columnWidth = 0;

    private rowHeight = 24;
    private alternateRows = false;

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
        this.spacer = document.createElement('div');
        this.spacer.className = 'ts-spacer';
        this.body.appendChild(this.spacer);

        this.root.appendChild(this.head);
        this.root.appendChild(this.body);
        container.appendChild(this.root);

        // The header sits outside the scroll container so it stays put vertically; it has to be
        // dragged along horizontally by hand.
        this.body.addEventListener('scroll', () => {
            this.head.scrollLeft = this.body.scrollLeft;
        });

        this.body.addEventListener('click', (evt) => this.onBodyClick(evt));
    }

    /**
     * Replaces the data.
     *
     * Filters are keyed by column index and survive a row-only refresh, which is what makes the
     * table usable while a slicer elsewhere on the page is being adjusted.
     */
    public setData(columns: ITableColumn[], rows: Row[]): void {
        const columnsChanged =
            columns.length !== this.columns.length ||
            columns.some((c, i) => this.columns[i].label !== c.label || this.columns[i].type !== c.type);

        this.columns = columns;
        this.rows = rows;

        if (columnsChanged) {
            this.filters.clear();
            if (this.sort && this.sort.column >= columns.length) {
                this.sort = null;
            }
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

        const rowHeight = Math.max(12, Math.round(appearance.rowHeight));
        const heightChanged = rowHeight !== this.rowHeight;
        this.rowHeight = rowHeight;

        if (heightChanged) {
            // The virtualiser caches measurements against the old height, so it has to be told
            // before the next paint.
            this.syncVirtualizer();
        }
        this.renderBody();
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

        this.columns.forEach((column, i) => {
            const th = document.createElement('div');
            th.className = 'ts-th';

            const label = document.createElement('div');
            label.className = 'ts-th-label';
            label.title = `${column.label} — click to sort`;

            const text = document.createElement('span');
            text.className = 'ts-th-text';
            text.textContent = column.label;
            label.appendChild(text);

            const indicator = document.createElement('span');
            indicator.className = 'ts-th-sort';
            label.appendChild(indicator);
            this.sortIndicators.set(i, indicator);

            label.addEventListener('click', () => this.toggleSort(i));

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

            th.appendChild(label);
            th.appendChild(filter);
            this.headRow.appendChild(th);
        });

        this.updateSortIndicators();
        this.applyColumnWidths();
    }

    /**
     * Columns share the width evenly, down to `minColumnWidth`; past that the table scrolls
     * horizontally rather than squeezing text into nothing.
     */
    private applyColumnWidths(): void {
        if (this.columns.length === 0) {
            return;
        }
        const available = this.body.clientWidth || this.root.clientWidth;
        const even = Math.floor(available / this.columns.length);
        this.columnWidth = Math.max(this.options.minColumnWidth, even);

        const total = this.columnWidth * this.columns.length;
        this.headRow.style.width = `${total}px`;
        this.spacer.style.width = `${total}px`;

        Array.from(this.headRow.children).forEach((th) => {
            (th as HTMLElement).style.width = `${this.columnWidth}px`;
        });
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

    /** Recomputes which rows are shown, in what order, then repaints the body. */
    private refreshView(): void {
        const columnsByIndex = this.columns;
        const active: { position: number; needle: string; type: ColumnType }[] = [];
        this.filters.forEach((needle, i) => {
            const column = columnsByIndex[i];
            if (column) {
                active.push({ position: column.index, needle, type: column.type });
            }
        });

        const view: number[] = [];
        for (let r = 0; r < this.rows.length; r++) {
            const row = this.rows[r];
            let keep = true;
            for (let f = 0; f < active.length; f++) {
                const { position, needle, type } = active[f];
                const text = formatValue(row[position], type).toLowerCase();
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

            this.columns.forEach((column) => {
                const td = document.createElement('div');
                td.className = 'ts-cell';
                td.style.width = `${this.columnWidth}px`;
                const text = formatValue(row[column.index], column.type);
                if (text === '') {
                    td.classList.add('ts-missing');
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
        const additive = evt.ctrlKey || evt.metaKey;

        if (additive) {
            if (this.selected.has(rowIndex)) {
                this.selected.delete(rowIndex);
            } else {
                this.selected.add(rowIndex);
            }
        } else if (this.selected.size === 1 && this.selected.has(rowIndex)) {
            // Clicking the only selected row again clears it.
            this.selected.clear();
        } else {
            this.selected = new Set([rowIndex]);
        }

        this.renderBody();
        this.callbacks.onSelectionChanged(Array.from(this.selected));
    }
}
