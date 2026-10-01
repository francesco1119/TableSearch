/*
 * TableSearch — a searchable, cross-filtering table for Power BI
 *
 * Copyright (c) Francesco Mantovani. Released under the MIT License.
 *
 * The Power BI plumbing only. Everything visible lives in `table.ts`.
 *
 * This file began as the archived lineupjs/lineup_powerbi wrapper (MIT, Copyright (c) Samuel
 * Gratzl), which wrapped LineUp.js. LineUp was dropped once it was clear the product is a
 * filter table rather than a ranking tool: nearly every requirement turned out to be the
 * suppression of one of its features, and its filter widget rebuilt the whole column header on
 * each keystroke. None of that code remains, but the shape of the dataView handling here is
 * owed to it.
 */

import powerbi from 'powerbi-visuals-api';
import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel';

import { IAppearance, ICellStyle, ISortState, ITableColumn, SearchTable } from './table';
import { IColumnTarget, TableSearchSettings } from './settings';
import '../style/style.less';

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import PowerBISortDirection = powerbi.SortDirection;
import VisualUpdateType = powerbi.VisualUpdateType;

interface IExtracted {
    columns: ITableColumn[];
    rows: unknown[][];
    ids: ISelectionId[];
    /** One selection id per column, scoped by queryName — what the fx rule editor selects on. */
    columnIds: ISelectionId[];
    sort: ISortState | null;
    styles: (ICellStyle | null)[][] | null;
}

/** Pulls a colour out of a `fill` property, whether the host resolved it or left it unset. */
function fillColor(value: unknown): string | undefined {
    const solid = (value as { solid?: { color?: unknown } } | undefined)?.solid;
    const color = solid && solid.color;
    return typeof color === "string" && color !== "" ? color : undefined;
}

/**
 * Reads the `cellElements` colours off one set of object instances.
 *
 * The host puts them in two different places: a plain colour lands on the metadata column, a
 * rule (the *fx* button) is resolved per row and lands on `DataViewTableRow.objects`. Both
 * arrive in this shape, so the same reader serves both.
 */
function readCellStyle(objects: powerbi.DataViewObjects | undefined): ICellStyle | null {
    const cell = objects && objects.cellElements;
    if (!cell) {
        return null;
    }
    const background = fillColor(cell.backgroundColor);
    const color = fillColor(cell.fontColor);
    return background || color ? { background, color } : null;
}

export class TableSearchVisual implements IVisual {
    private readonly host: IVisualHost;
    private readonly selectionManager: ISelectionManager;
    private readonly container: HTMLElement;
    private readonly table: SearchTable;
    private readonly formattingService = new FormattingSettingsService();
    private settings = new TableSearchSettings();

    /** Row index -> selection id, rebuilt on every extract. */
    private ids: ISelectionId[] = [];

    /** Column position (matching `columns` passed to the table) -> selection id, rebuilt on every extract. */
    private columnIds: ISelectionId[] = [];

    /** Guards the table's selection callback while a report-driven selection is being applied. */
    private applyingSelection = false;

    /** Power BI's field-well sort as of the last update, so it's applied only when it changes. */
    private hostSortKey: string | null = null;

    /** Set while a `fetchMoreData` request is outstanding. */
    private waitingForMoreData = false;

    /** Row currently under the pointer, so a further move can `move()` the tooltip instead of
     *  re-`show()`-ing it. */
    private hoveredRow: number | null = null;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = options.host.createSelectionManager();

        this.container = document.createElement('div');
        this.container.className = 'ts';
        options.element.appendChild(this.container);

        this.table = new SearchTable(this.container, {
            onSelectionChanged: (indices) => this.onTableSelection(indices),
            onColumnContextMenu: (column, x, y) => this.onColumnContextMenu(column, x, y),
            onRowContextMenu: (row, x, y) => this.onRowContextMenu(row, x, y),
            onRowHover: (row, items, x, y) => this.onRowHover(row, items, x, y),
            onRowHoverEnd: () => this.onRowHoverEnd(),
            onLaunchUrl: (url) => this.host.launchUrl(url),
        });
        this.table.setLocale(this.host.locale);
        this.table.setAppearance(this.appearance());

        // Power BI can clear or change the selection from outside the visual — another visual's
        // selection, or the report's clear-filter button. Mirror that back into the table.
        this.selectionManager.registerOnSelectCallback(() => this.restoreSelection());

        // Right-click anywhere a row or header didn't claim (empty space, totals row): the host's
        // menu with an empty selection, as certification requires a menu everywhere in the visual.
        options.element.addEventListener('contextmenu', (evt) => {
            if (evt.defaultPrevented) {
                return;
            }
            evt.preventDefault();
            void this.selectionManager.showContextMenu({}, { x: evt.clientX, y: evt.clientY });
        });
    }

    public update(options: VisualUpdateOptions): void {
        // A resize carries the same dataView; re-extracting it would rebuild every selection id
        // and re-sort for nothing.
        const resizeOnly =
            options.type === VisualUpdateType.Resize || options.type === VisualUpdateType.ResizeEnd;
        if (resizeOnly) {
            this.table.layout();
            return;
        }

        const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
        const table = dataView && dataView.table;
        if (!table) {
            return;
        }

        this.settings = this.formattingService.populateFormattingSettingsModel(
            TableSearchSettings,
            dataView
        );
        // The Cell elements card is per column, so it can only be built once the field well is
        // known. Rebuilt every update because that field well can change.
        this.settings.cellElements.setColumns(this.formatTargets(table));
        this.table.setAppearance(this.appearance());

        this.waitingForMoreData = false;

        const { columns, rows, ids, columnIds, sort, styles } = this.extract(table);
        this.ids = ids;
        this.columnIds = columnIds;

        // Only push Power BI's sort when it actually changed; otherwise every update (a
        // cross-filter, a data page, a format-pane edit) would wipe the sort the user clicked.
        const sortColumn = sort && table.columns[sort.column];
        const sortColumnId = sortColumn?.queryName || sortColumn?.displayName || '';
        // The field list is part of the key: if it changes, a kept sort index could point at a
        // different column, so the host's sort is re-applied.
        const fieldsKey = table.columns.map((c) => c.queryName || c.displayName).join('|');
        const sortKey = `${fieldsKey}#${sort ? `${sortColumnId}:${sort.direction}` : ''}`;
        const sortChanged = sortKey !== this.hostSortKey;
        this.hostSortKey = sortKey;

        this.table.setData(columns, rows, styles, sortChanged ? sort : undefined);
        this.table.layout();
        this.restoreSelection();

        this.requestMoreDataIfAvailable(dataView);
    }

    /** Called by the host to render the format pane. */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingService.buildFormattingModel(this.settings);
    }

    /** Flattens the format-pane model into what the table actually needs. */
    private appearance(): IAppearance {
        const { table, search, colors } = this.settings;
        return {
            rowHeight: table.rowHeight.value,
            fontSize: table.fontSize.value,
            alternateRows: table.alternateRows.value,
            showTotals: table.showTotals.value,
            linkIcon: table.linkIcon.value,
            showSearch: search.show.value,
            headerBackground: colors.headerBackground.value.value,
            textColor: colors.textColor.value.value,
            gridColor: colors.gridColor.value.value,
            selectionColor: colors.selectionColor.value.value,
        };
    }

    public destroy(): void {
        this.table.destroy();
        this.container.remove();
        this.ids = [];
        this.columnIds = [];
    }

    private extract(table: DataViewTable): IExtracted {
        const rows = (table.rows || []) as unknown[][];

        const columns: ITableColumn[] = table.columns.map((d) => {
            let type: ITableColumn['type'] = 'string';
            // A row identifier is always shown as text, whatever Power BI calls it.
            if (d.type && !(d.roles && d.roles.row)) {
                if (d.type.bool) {
                    type = 'boolean';
                } else if (d.type.integer || d.type.numeric) {
                    type = 'number';
                } else if (d.type.dateTime) {
                    type = 'date';
                }
            }
            const isUrl = !!(d.type && d.type.misc && d.type.misc.webUrl);
            const isImage = !!(d.type && d.type.misc && d.type.misc.imageUrl);
            return { label: d.displayName, index: d.index!, type, isUrl, isImage, format: d.format };
        });

        const ids = rows.map((_, rowIndex) =>
            this.host.createSelectionIdBuilder().withTable(table, rowIndex).createSelectionId()
        );

        // `withMeasure` scopes the id to the column's queryName, matching the `selector: {
        // metadata: queryName }` the Cell elements card uses — that agreement is what makes the
        // context menu offer conditional formatting for the right column.
        const columnIds = table.columns.map((d) =>
            this.host
                .createSelectionIdBuilder()
                .withMeasure(d.queryName || d.displayName)
                .createSelectionId()
        );

        // Power BI allows several sort columns; the table sorts by one, so the primary wins.
        const sorted = table.columns
            .filter((d) => d.sort)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const primary = sorted[0];
        const sort: ISortState | null = primary
            ? {
                  column: table.columns.indexOf(primary),
                  direction: primary.sort === PowerBISortDirection.Ascending ? 'asc' : 'desc',
              }
            : null;

        return { columns, rows, ids, columnIds, sort, styles: this.extractStyles(table, columns) };
    }

    /** One entry per field-well column, carrying whatever colour is already set on it. */
    private formatTargets(table: DataViewTable): IColumnTarget[] {
        return table.columns.map((column) => {
            const style = readCellStyle(column.objects);
            return {
                displayName: column.displayName,
                queryName: column.queryName || column.displayName,
                background: style ? style.background : undefined,
                fontColor: style ? style.color : undefined,
            };
        });
    }

    /**
     * Conditional-formatting colours per cell, indexed to match `columns`.
     *
     * Returns null when nothing is formatted -- the overwhelmingly common case -- so the table can
     * skip the per-cell lookup entirely.
     */
    private extractStyles(
        table: DataViewTable,
        columns: ITableColumn[]
    ): (ICellStyle | null)[][] | null {
        const perColumn = new Map<number, ICellStyle>();
        table.columns.forEach((column) => {
            const style = readCellStyle(column.objects);
            if (style && column.index !== undefined) {
                perColumn.set(column.index, style);
            }
        });

        const rows = table.rows || [];
        const anyRuleApplied = rows.some((row) => !!row.objects);
        if (!anyRuleApplied && perColumn.size === 0) {
            return null;
        }

        return rows.map((row) =>
            columns.map((column) => {
                const fromRule = row.objects && readCellStyle(row.objects[column.index]);
                return fromRule || perColumn.get(column.index) || null;
            })
        );
    }

    /** Right-click on a column header: the host's own menu, including conditional formatting. */
    private onColumnContextMenu(column: number, x: number, y: number): void {
        void this.selectionManager.showContextMenu(this.columnIds[column] || {}, { x, y });
    }

    /** Right-click on a row: the host's own menu (filter, drillthrough, ...) for that data point. */
    private onRowContextMenu(row: number, x: number, y: number): void {
        void this.selectionManager.showContextMenu(this.ids[row] || {}, { x, y });
    }

    /** Pointer over a row: the host's default tooltip, one line per column. */
    private onRowHover(row: number, items: { displayName: string; value: string }[], x: number, y: number): void {
        const id = this.ids[row];
        if (!id) {
            return;
        }
        const options = { coordinates: [x, y], isTouchEvent: false, dataItems: items, identities: [id] };
        if (this.hoveredRow === row) {
            this.host.tooltipService.move(options);
        } else {
            this.hoveredRow = row;
            this.host.tooltipService.show(options);
        }
    }

    /** Pointer left the body: dismiss the tooltip. */
    private onRowHoverEnd(): void {
        if (this.hoveredRow === null) {
            return;
        }
        this.hoveredRow = null;
        this.host.tooltipService.hide({ isTouchEvent: false, immediately: true });
    }

    /** Pushes the table's own selection out to the rest of the report. */
    private onTableSelection(indices: number[]): void {
        if (this.applyingSelection) {
            return;
        }
        const selected = indices.map((i) => this.ids[i]).filter((id) => !!id);
        if (selected.length > 0) {
            void this.selectionManager.select(selected);
        } else {
            void this.selectionManager.clear();
        }
    }

    /** Pushes the report's current selection into the table without echoing it back out. */
    private restoreSelection(): void {
        const current = (this.selectionManager.getSelectionIds() || []) as ISelectionId[];
        const keys = new Set(current.map((id) => id.getKey()));
        const indices: number[] = [];
        this.ids.forEach((id, i) => {
            if (id && keys.has(id.getKey())) {
                indices.push(i);
            }
        });

        this.applyingSelection = true;
        try {
            this.table.setSelection(indices);
        } finally {
            this.applyingSelection = false;
        }
    }

    /**
     * The table mapping uses a windowed data reduction, so the host hands over one window at a
     * time and appends the next only when asked. `metadata.segment` is present for as long as
     * the result is incomplete.
     */
    private requestMoreDataIfAvailable(dataView: DataView): void {
        const hasMore = !!(dataView.metadata && (dataView.metadata as any).segment);
        if (hasMore && !this.waitingForMoreData && this.host.fetchMoreData) {
            this.waitingForMoreData = true;
            this.host.fetchMoreData(true);
        }
    }
}
